import { getRequest } from "@tanstack/react-start/server";

export type AppRole = "viewer" | "data_editor" | "config_admin";
export type AppAccessMode = "public" | "org" | "restricted";

const RANK: Record<AppRole, number> = { viewer: 1, data_editor: 2, config_admin: 3 };

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

/** Liest die Supabase-Identität optional aus einem Server-Request. */
export async function optionalRequestUserId(): Promise<string | null> {
  const request = getRequest();
  const header = request?.headers.get("authorization") ?? "";
  const token = /^Bearer\s+(.+)$/i.exec(header)?.[1]?.trim();
  if (!token || token.split(".").length !== 3) return null;
  const db = await admin();
  const { data, error } = await db.auth.getUser(token);
  return error ? null : (data.user?.id ?? null);
}

export async function appRoleOf(userId: string | null, appId: string): Promise<AppRole | null> {
  const db = await admin();
  const { data: app } = await db
    .from("apps")
    .select("user_id,org_id,access_mode,is_public,access_revoked_at,access_expires_at")
    .eq("id", appId)
    .maybeSingle();
  if (!app) return null;
  if (!userId) {
    if (!app.is_public || app.access_mode !== "public" || app.access_revoked_at) return null;
    if (app.access_expires_at && new Date(app.access_expires_at).getTime() <= Date.now()) return null;
    return "viewer";
  }
  if (app.user_id === userId) return "config_admin";

  let orgMember = false;
  if (app.org_id) {
    const { data: membership } = await db
      .from("organization_members")
      .select("role")
      .eq("org_id", app.org_id)
      .eq("user_id", userId)
      .maybeSingle();
    orgMember = Boolean(membership);
    if (membership?.role === "owner" || membership?.role === "admin") return "config_admin";
  }

  const [{ data: direct }, { data: teamRows }] = await Promise.all([
    db
      .from("app_permissions")
      .select("role")
      .eq("app_id", appId)
      .eq("subject_type", "user")
      .eq("subject_id", userId)
      .maybeSingle(),
    db.from("team_members").select("team_id").eq("user_id", userId),
  ]);
  const teamIds = (teamRows ?? []).map((row) => row.team_id);
  const { data: teamGrants } = teamIds.length
    ? await db
        .from("app_permissions")
        .select("role")
        .eq("app_id", appId)
        .eq("subject_type", "team")
        .in("subject_id", teamIds)
    : { data: [] as { role: string }[] };

  if (!app.is_public || app.access_revoked_at) return null;
  if (app.access_expires_at && new Date(app.access_expires_at).getTime() <= Date.now()) return null;
  let best = app.access_mode === "public" || (app.access_mode === "org" && orgMember) ? 1 : 0;
  for (const grant of [direct, ...(teamGrants ?? [])]) {
    const role = grant?.role as AppRole | undefined;
    if (role) best = Math.max(best, RANK[role]);
  }
  return best === 3 ? "config_admin" : best === 2 ? "data_editor" : best === 1 ? "viewer" : null;
}

export async function assertAppRole(userId: string, appId: string, minimum: AppRole) {
  const role = await appRoleOf(userId, appId);
  if (!role || RANK[role] < RANK[minimum]) {
    throw new Error(
      minimum === "config_admin"
        ? "Nur Konfigurationsadministratoren dürfen diese App ändern."
        : minimum === "data_editor"
          ? "Für diese Änderung brauchst du das Recht ‚Daten aktualisieren‘."
          : "Kein Zugriff auf diese App.",
    );
  }
  return role;
}
