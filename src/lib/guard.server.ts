// Serverseitige Prüfungen, die unabhängig von der Oberfläche greifen.

import { ROLE_RANK, roleFromRank, type AccessRole } from "@/lib/permissions";

export type BoardRole = AccessRole;

const ORDER = ROLE_RANK;

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

/** Gesperrte oder zur Löschung vorgemerkte Konten dürfen nichts mehr auslösen. */
export async function assertActiveUser(userId: string) {
  const db = await admin();
  const { data } = await db
    .from("profiles")
    .select("blocked_at")
    .eq("id", userId)
    .maybeSingle();
  if (data?.blocked_at) throw new Error("Dieses Konto ist gesperrt.");
}

/** Alle Teams, in denen das Konto Mitglied ist. */
async function teamsOf(userId: string): Promise<Set<string>> {
  const db = await admin();
  const { data } = await db.from("team_members").select("team_id").eq("user_id", userId);
  return new Set((data ?? []).map((row) => row.team_id));
}

/**
 * Rolle des Kontos in einem Scope – oder null, wenn kein Zugriff besteht.
 * Es gilt das höchste Recht aus persönlicher Freigabe, Team-Freigabe und Organisationsrolle.
 */
export async function boardRoleOf(userId: string, boardId: string): Promise<BoardRole | null> {
  const db = await admin();
  const [board, member, teamAccess] = await Promise.all([
    db.from("boards").select("user_id,org_id").eq("id", boardId).maybeSingle(),
    db
      .from("board_members")
      .select("role")
      .eq("board_id", boardId)
      .eq("user_id", userId)
      .maybeSingle(),
    db.from("board_team_access").select("role,team_id").eq("board_id", boardId),
  ]);
  if (!board.data) return null;
  if (board.data.user_id === userId) return "owner";

  let best = 0;
  const raise = (role: string | null | undefined) => {
    const rank = ORDER[(role ?? "") as BoardRole] ?? 0;
    if (rank > best) best = rank;
  };

  raise(member.data?.role);

  const teamIds = (teamAccess.data ?? []).map((row) => row.team_id);
  if (teamIds.length) {
    const myTeams = await teamsOf(userId);
    for (const row of teamAccess.data ?? []) {
      if (myTeams.has(row.team_id)) raise(row.role);
    }
  }

  if (board.data.org_id) {
    const { data: membership } = await db
      .from("organization_members")
      .select("role")
      .eq("org_id", board.data.org_id)
      .eq("user_id", userId)
      .maybeSingle();
    if (membership?.role === "owner" || membership?.role === "admin") raise("editor");
  }

  return roleFromRank(best);
}

/** Erzwingt mindestens die verlangte Rolle und gibt die tatsächliche zurück. */
export async function assertBoardRole(
  userId: string,
  boardId: string,
  min: BoardRole,
): Promise<BoardRole> {
  await assertActiveUser(userId);
  const role = await boardRoleOf(userId, boardId);
  if (!role || ORDER[role] < ORDER[min]) {
    throw new Error(
      min === "owner"
        ? "Nur Inhaber dürfen diesen Vorgang ausführen"
        : min === "editor"
          ? "Dafür brauchst du Bearbeitungsrechte in diesem Scope"
          : min === "commenter"
            ? "Dafür brauchst du mindestens das Recht zu kommentieren"
            : "Kein Zugriff auf diesen Scope",
    );
  }
  return role;
}

type Rule = {
  node_id: string;
  subject_type: string;
  subject_id: string | null;
  role: string;
};

/** Engste passende Regel für ein Modul – Regeln am Hintergrundfeld gelten für alles darin. */
function ruleRank(rules: Rule[], userId: string, myTeams: Set<string>): number | null {
  let best: number | null = null;
  for (const rule of rules) {
    const matches =
      rule.subject_type === "default" ||
      (rule.subject_type === "user" && rule.subject_id === userId) ||
      (rule.subject_type === "team" && rule.subject_id !== null && myTeams.has(rule.subject_id));
    if (!matches) continue;
    const rank = ORDER[rule.role as BoardRole] ?? 0;
    if (best === null || rank > best) best = rank;
  }
  return best;
}

/**
 * Alle Module eines Scopes, für die eine abweichende Regel gilt –
 * als Karte Modul-Id → tatsächliches Recht.
 */
export async function nodeRoleMap(
  userId: string,
  boardId: string,
  boardRole: BoardRole,
): Promise<Record<string, AccessRole>> {
  if (boardRole === "owner") return {};
  const db = await admin();
  const [rulesRes, nodesRes] = await Promise.all([
    db.from("node_permissions").select("node_id,subject_type,subject_id,role").eq("board_id", boardId),
    db.from("nodes").select("id,parent_id").eq("board_id", boardId),
  ]);
  const rules = (rulesRes.data ?? []) as Rule[];
  if (!rules.length) return {};
  const myTeams = await teamsOf(userId);
  const byNode = new Map<string, Rule[]>();
  for (const rule of rules) {
    const list = byNode.get(rule.node_id) ?? [];
    list.push(rule);
    byNode.set(rule.node_id, list);
  }

  const base = ORDER[boardRole];
  const out: Record<string, AccessRole> = {};
  for (const node of nodesRes.data ?? []) {
    let rank = ruleRank(byNode.get(node.id) ?? [], userId, myTeams);
    if (rank === null && node.parent_id) {
      rank = ruleRank(byNode.get(node.parent_id) ?? [], userId, myTeams);
    }
    if (rank === null) continue;
    const effective = roleFromRank(Math.min(base, rank));
    if (effective && effective !== boardRole) out[node.id] = effective;
  }
  return out;
}

/** Tatsächliches Recht an einem einzelnen Modul. */
export async function nodeRoleOf(userId: string, nodeId: string): Promise<AccessRole | null> {
  const db = await admin();
  const { data: node } = await db
    .from("nodes")
    .select("id,board_id,parent_id")
    .eq("id", nodeId)
    .maybeSingle();
  if (!node) return null;
  const boardRole = await boardRoleOf(userId, node.board_id);
  if (!boardRole) return null;
  if (boardRole === "owner") return "owner";

  const ids = node.parent_id ? [node.id, node.parent_id] : [node.id];
  const { data: rules } = await db
    .from("node_permissions")
    .select("node_id,subject_type,subject_id,role")
    .in("node_id", ids);
  const list = (rules ?? []) as Rule[];
  const myTeams = await teamsOf(userId);
  let rank = ruleRank(list.filter((rule) => rule.node_id === node.id), userId, myTeams);
  if (rank === null && node.parent_id) {
    rank = ruleRank(list.filter((rule) => rule.node_id === node.parent_id), userId, myTeams);
  }
  return roleFromRank(rank === null ? ORDER[boardRole] : Math.min(ORDER[boardRole], rank));
}

/** Erzwingt mindestens das verlangte Recht an einem Modul. */
export async function assertNodeRole(userId: string, nodeId: string, min: AccessRole) {
  await assertActiveUser(userId);
  const role = await nodeRoleOf(userId, nodeId);
  if (!role || ORDER[role] < ORDER[min]) {
    throw new Error(
      min === "editor"
        ? "Dieses Modul darfst du nur ansehen"
        : min === "commenter"
          ? "Hier darfst du nicht kommentieren"
          : "Kein Zugriff auf dieses Modul",
    );
  }
  return role;
}
