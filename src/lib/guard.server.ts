// Serverseitige Prüfungen, die unabhängig von der Oberfläche greifen.

export type BoardRole = "owner" | "editor" | "viewer";

const ORDER: Record<BoardRole, number> = { viewer: 1, editor: 2, owner: 3 };

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

  let best: BoardRole | null = null;
  const raise = (role: BoardRole) => {
    if (!best || ORDER[role] > ORDER[best]) best = role;
  };

  if (member.data?.role === "editor" || member.data?.role === "viewer") raise(member.data.role);

  const teamIds = (teamAccess.data ?? []).map((row) => row.team_id);
  if (teamIds.length) {
    const { data: mine } = await db
      .from("team_members")
      .select("team_id")
      .eq("user_id", userId)
      .in("team_id", teamIds);
    const myTeams = new Set((mine ?? []).map((row) => row.team_id));
    for (const row of teamAccess.data ?? []) {
      if (myTeams.has(row.team_id)) raise(row.role === "editor" ? "editor" : "viewer");
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

  return best;
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
          : "Kein Zugriff auf diesen Scope",
    );
  }
  return role;
}
