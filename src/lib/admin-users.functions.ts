import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

async function assertAdmin(context: { supabase: { rpc: Function }; userId: string }) {
  const { data, error } = await context.supabase.rpc("has_role", {
    _user_id: context.userId,
    _role: "admin",
  });
  if (error) throw new Error((error as { message: string }).message);
  if (!data) throw new Error("Nur Administratoren dürfen diesen Bereich nutzen");
}

async function audit(entry: {
  actorId: string;
  subjectUserId?: string | null;
  action: string;
  objectType?: string;
  objectId?: string | null | undefined;
  detail?: string;
}) {
  const db = await admin();
  await db.from("audit_log").insert({
    actor_id: entry.actorId,
    subject_user_id: entry.subjectUserId ?? null,
    action: entry.action,
    object_type: entry.objectType ?? null,
    object_id: entry.objectId ?? null,
    detail: entry.detail ?? null,
  });
}

/** Rechte-Übersicht eines Kontos: Scopes, Teams, Apps, Organisationen, Protokoll. */
export const adminGetUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ userId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context as never);
    const db = await admin();
    const [profile, roles, orgs, boards, members, teams, apps, log] = await Promise.all([
      db
        .from("profiles")
        .select("id,email,display_name,avatar_url,blocked_at,deletion_requested_at,created_at,updated_at")
        .eq("id", data.userId)
        .maybeSingle(),
      db.from("user_roles").select("role").eq("user_id", data.userId),
      db.from("organization_members").select("org_id,role,organizations(name)").eq("user_id", data.userId),
      db.from("boards").select("id,title,updated_at").eq("user_id", data.userId).order("updated_at", { ascending: false }),
      db.from("board_members").select("id,board_id,role,boards(title)").eq("user_id", data.userId),
      db.from("team_members").select("team_id,teams(name,org_id)").eq("user_id", data.userId),
      db.from("apps").select("id,title,is_public,mcp_scope").eq("user_id", data.userId),
      db
        .from("audit_log")
        .select("id,action,object_type,object_id,detail,created_at")
        .or(`actor_id.eq.${data.userId},subject_user_id.eq.${data.userId}`)
        .order("created_at", { ascending: false })
        .limit(50),
    ]);

    if (!profile.data) throw new Error("Konto nicht gefunden");

    return {
      id: profile.data.id,
      email: profile.data.email ?? "",
      displayName: profile.data.display_name ?? "",
      avatarUrl: profile.data.avatar_url,
      blocked: Boolean(profile.data.blocked_at),
      deletionRequestedAt: profile.data.deletion_requested_at,
      createdAt: profile.data.created_at,
      lastActive: profile.data.updated_at,
      isAdmin: (roles.data ?? []).some((row) => row.role === "admin"),
      orgs: (orgs.data ?? []).map((row) => ({
        id: row.org_id,
        role: row.role as string,
        name: (row.organizations as unknown as { name?: string } | null)?.name ?? "",
      })),
      ownedScopes: (boards.data ?? []).map((row) => ({ id: row.id, title: row.title, updatedAt: row.updated_at })),
      sharedScopes: (members.data ?? []).map((row) => ({
        id: row.id,
        boardId: row.board_id,
        role: row.role,
        title: (row.boards as unknown as { title?: string } | null)?.title ?? "",
      })),
      teams: (teams.data ?? []).map((row) => ({
        id: row.team_id,
        name: (row.teams as unknown as { name?: string } | null)?.name ?? "",
      })),
      apps: (apps.data ?? []).map((row) => ({
        id: row.id,
        title: row.title,
        isPublic: row.is_public,
        scope: row.mcp_scope,
      })),
      log: log.data ?? [],
    };
  });

/** Freigabe eines Scopes für ein Konto entziehen. */
export const adminRevokeBoardAccess = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ memberId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context as never);
    const db = await admin();
    const { error } = await db.from("board_members").delete().eq("id", data.memberId);
    if (error) throw new Error(error.message);
    await audit({ actorId: context.userId, action: "board.access_revoked", objectType: "board_member", objectId: data.memberId });
    return { ok: true };
  });

/** Konto direkt anlegen (Administrator vergibt Zugang). */
export const adminCreateUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({
        email: z.string().trim().email(),
        displayName: z.string().trim().max(80).default(""),
        password: z.string().min(10).max(72),
        orgId: z.string().uuid().optional(),
        orgRole: z.enum(["admin", "member", "guest"]).default("member"),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context as never);
    const db = await admin();
    const { data: created, error } = await db.auth.admin.createUser({
      email: data.email,
      password: data.password,
      email_confirm: true,
      user_metadata: { full_name: data.displayName || data.email.split("@")[0] },
    });
    if (error || !created.user) throw new Error(error?.message ?? "Konto konnte nicht angelegt werden");

    if (data.orgId) {
      await db
        .from("organization_members")
        .upsert(
          { org_id: data.orgId, user_id: created.user.id, role: data.orgRole },
          { onConflict: "org_id,user_id" },
        );
    }
    await audit({
      actorId: context.userId,
      subjectUserId: created.user.id,
      action: "account.created",
      objectType: "user",
      objectId: created.user.id,
      detail: data.email,
    });
    return { id: created.user.id };
  });

/** Passwort-Zurücksetzen per E-Mail auslösen. */
export const adminSendPasswordReset = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z.object({ email: z.string().email(), origin: z.string().url() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context as never);
    const db = await admin();
    const { error } = await db.auth.resetPasswordForEmail(data.email, {
      redirectTo: `${data.origin.replace(/\/$/, "")}/auth`,
    });
    if (error) throw new Error(error.message);
    await audit({ actorId: context.userId, action: "account.password_reset_sent", detail: data.email });
    return { ok: true };
  });

/** Anmeldungen eines Kontos anzeigen (ohne IP und Standort). */
export const adminListSessions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ userId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context as never);
    const db = await admin();
    const { data: rows, error } = await db.rpc("list_user_sessions", { _user: data.userId });
    if (error) throw new Error(error.message);
    return (rows ?? []) as { id: string; created_at: string; refreshed_at: string | null; user_agent: string | null }[];
  });

/** Anmeldungen beenden – einzeln oder alle. */
export const adminEndSessions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z.object({ userId: z.string().uuid(), sessionId: z.string().uuid().nullable().default(null) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context as never);
    const db = await admin();
    const { error } = await db.rpc("end_user_sessions", { _user: data.userId, _session: data.sessionId ?? (undefined as unknown as string) });
    if (error) throw new Error(error.message);
    await audit({
      actorId: context.userId,
      subjectUserId: data.userId,
      action: "account.sessions_ended",
      objectType: "user",
      objectId: data.userId,
    });
    return { ok: true };
  });

/** Eigene Anmeldungen ansehen und beenden. */
export const listMySessions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const db = await admin();
    const { data, error } = await db.rpc("list_user_sessions", { _user: context.userId });
    if (error) throw new Error(error.message);
    return (data ?? []) as { id: string; created_at: string; refreshed_at: string | null; user_agent: string | null }[];
  });

export const endMySessions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z.object({ sessionId: z.string().uuid().nullable().default(null) }).default({ sessionId: null }).parse(input ?? {}),
  )
  .handler(async ({ data, context }) => {
    const db = await admin();
    const { error } = await db.rpc("end_user_sessions", { _user: context.userId, _session: data.sessionId ?? (undefined as unknown as string) });
    if (error) throw new Error(error.message);
    await audit({
      actorId: context.userId,
      subjectUserId: context.userId,
      action: "account.sessions_ended",
      objectType: "user",
      objectId: context.userId,
    });
    return { ok: true };
  });

/** KI-Nutzung und geschätzte Kosten je Konto im Zeitraum. */
export const adminUsageSummary = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z.object({ days: z.number().int().min(1).max(365).default(30) }).default({ days: 30 }).parse(input ?? {}),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context as never);
    const db = await admin();
    const since = new Date(Date.now() - data.days * 86_400_000).toISOString();
    const { data: rows, error } = await db
      .from("ai_usage")
      .select("user_id,provider,fn,cost_usd,input_tokens,output_tokens,ok")
      .gte("created_at", since);
    if (error) throw new Error(error.message);

    const byUser = new Map<string, { cost: number; calls: number; tokens: number; failed: number }>();
    const byFn = new Map<string, { cost: number; calls: number }>();
    for (const row of rows ?? []) {
      const user = byUser.get(row.user_id) ?? { cost: 0, calls: 0, tokens: 0, failed: 0 };
      user.cost += Number(row.cost_usd ?? 0);
      user.calls += 1;
      user.tokens += (row.input_tokens ?? 0) + (row.output_tokens ?? 0);
      if (!row.ok) user.failed += 1;
      byUser.set(row.user_id, user);

      const fn = byFn.get(row.fn) ?? { cost: 0, calls: 0 };
      fn.cost += Number(row.cost_usd ?? 0);
      fn.calls += 1;
      byFn.set(row.fn, fn);
    }

    const ids = Array.from(byUser.keys());
    const profiles = ids.length ? (await db.from("profiles").select("id,email,display_name").in("id", ids)).data : [];
    const names = new Map((profiles ?? []).map((p) => [p.id, p.display_name || p.email || ""]));

    return {
      days: data.days,
      totalCost: Array.from(byUser.values()).reduce((sum, row) => sum + row.cost, 0),
      users: ids
        .map((id) => ({ id, name: names.get(id) ?? "Unbekannt", ...byUser.get(id)! }))
        .sort((a, b) => b.cost - a.cost),
      functions: Array.from(byFn.entries())
        .map(([fn, value]) => ({ fn, ...value }))
        .sort((a, b) => b.cost - a.cost),
    };
  });
