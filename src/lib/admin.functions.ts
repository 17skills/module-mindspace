import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function assertAdmin(context: { supabase: any; userId: string }) {
  const { data, error } = await context.supabase.rpc("has_role", {
    _user_id: context.userId,
    _role: "admin",
  });
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Nur Administratoren dürfen diesen Bereich nutzen");
}

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

/** Konten mit Rolle, Sperre und Nutzungskennzahlen – mit Suche und Seitenweise. */
export const adminListUsers = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({
        search: z.string().max(120).optional(),
        limit: z.number().int().min(1).max(100).default(25),
        offset: z.number().int().min(0).default(0),
      })
      .default({ limit: 25, offset: 0 })
      .parse(input ?? {}),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context as never);
    const db = await admin();
    let query = db
      .from("profiles")
      .select(
        "id,email,display_name,avatar_url,blocked_at,deletion_requested_at,created_at,updated_at",
        { count: "exact" },
      )
      .order("created_at", { ascending: true })
      .range(data.offset, data.offset + data.limit - 1);
    const search = data.search?.trim();
    if (search) query = query.or(`email.ilike.%${search}%,display_name.ilike.%${search}%`);

    const [profiles, roles, boards] = await Promise.all([
      query,
      db.from("user_roles").select("user_id,role"),
      db.from("boards").select("user_id"),
    ]);

    const scopeCount = new Map<string, number>();
    for (const row of boards.data ?? []) {
      scopeCount.set(row.user_id, (scopeCount.get(row.user_id) ?? 0) + 1);
    }
    const adminIds = new Set((roles.data ?? []).filter((r) => r.role === "admin").map((r) => r.user_id));
    const devIds = new Set((roles.data ?? []).filter((r) => r.role === "developer").map((r) => r.user_id));

    return {
      total: profiles.count ?? 0,
      offset: data.offset,
      limit: data.limit,
      users: (profiles.data ?? []).map((profile) => ({
        id: profile.id,
        email: profile.email ?? "",
        displayName: profile.display_name ?? "",
        avatarUrl: profile.avatar_url ?? null,
        blocked: Boolean(profile.blocked_at),
        deletionRequestedAt: profile.deletion_requested_at,
        createdAt: profile.created_at,
        lastActive: profile.updated_at,
        scopes: scopeCount.get(profile.id) ?? 0,
        isAdmin: adminIds.has(profile.id),
        isDeveloper: devIds.has(profile.id),
      })),
    };
  });

/** Administratorrolle vergeben oder entziehen. */
export const adminSetRole = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z.object({ userId: z.string().uuid(), isAdmin: z.boolean() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context as never);
    if (data.userId === context.userId && !data.isAdmin) {
      throw new Error("Du kannst dir die Administratorrolle nicht selbst entziehen");
    }
    const db = await admin();
    if (data.isAdmin) {
      const { error } = await db
        .from("user_roles")
        .upsert({ user_id: data.userId, role: "admin" }, { onConflict: "user_id,role" });
      if (error) throw new Error(error.message);
    } else {
      const { error } = await db
        .from("user_roles")
        .delete()
        .eq("user_id", data.userId)
        .eq("role", "admin");
      if (error) throw new Error(error.message);
    }
    await db.from("audit_log").insert({
      actor_id: context.userId,
      subject_user_id: data.userId,
      action: data.isAdmin ? "role.admin_granted" : "role.admin_revoked",
      object_type: "user",
      object_id: data.userId,
    });
    return { ok: true };
  });

/** Entwicklerrolle vergeben oder entziehen – gibt Zugriff auf Code- und Schnittstellen-Werkzeuge. */
export const adminSetDeveloper = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z.object({ userId: z.string().uuid(), isDeveloper: z.boolean() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context as never);
    const db = await admin();
    if (data.isDeveloper) {
      const { error } = await db
        .from("user_roles")
        .upsert({ user_id: data.userId, role: "developer" }, { onConflict: "user_id,role" });
      if (error) throw new Error(error.message);
    } else {
      const { error } = await db
        .from("user_roles")
        .delete()
        .eq("user_id", data.userId)
        .eq("role", "developer");
      if (error) throw new Error(error.message);
    }
    await db.from("audit_log").insert({
      actor_id: context.userId,
      subject_user_id: data.userId,
      action: data.isDeveloper ? "role.developer_granted" : "role.developer_revoked",
      object_type: "user",
      object_id: data.userId,
    });
    return { ok: true };
  });

/** Konto sperren oder entsperren. */
export const adminSetBlocked = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z.object({ userId: z.string().uuid(), blocked: z.boolean() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context as never);
    if (data.userId === context.userId) throw new Error("Das eigene Konto kann nicht gesperrt werden");
    const db = await admin();
    const { error } = await db
      .from("profiles")
      .update({ blocked_at: data.blocked ? new Date().toISOString() : null })
      .eq("id", data.userId);
    if (error) throw new Error(error.message);
    await db.from("audit_log").insert({
      actor_id: context.userId,
      subject_user_id: data.userId,
      action: data.blocked ? "account.blocked" : "account.unblocked",
      object_type: "user",
      object_id: data.userId,
    });
    return { ok: true };
  });

/** Vollständiges Protokoll für Administratoren. */
export const adminListAuditLog = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context as never);
    const db = await admin();
    const { data, error } = await db
      .from("audit_log")
      .select("id,actor_id,subject_user_id,action,object_type,object_id,detail,created_at")
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw new Error(error.message);

    const ids = Array.from(
      new Set((data ?? []).flatMap((row) => [row.actor_id, row.subject_user_id]).filter(Boolean)),
    ) as string[];
    const names = new Map<string, string>();
    if (ids.length) {
      const { data: profiles } = await db.from("profiles").select("id,email").in("id", ids);
      for (const profile of profiles ?? []) names.set(profile.id, profile.email ?? "");
    }

    return (data ?? []).map((row) => ({
      id: row.id,
      action: row.action,
      objectType: row.object_type,
      objectId: row.object_id,
      detail: row.detail,
      createdAt: row.created_at,
      actor: row.actor_id ? names.get(row.actor_id) ?? "Unbekannt" : "System",
    }));
  });

/** Protokolleinträge älter als 90 Tage endgültig entfernen. */
export const adminPurgeAuditLog = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context as never);
    const db = await admin();
    const { error } = await db.rpc("purge_audit_log");
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Ausführungsverlauf der Auslöser (nur Admins, 90 Tage, ohne Nachrichteninhalte). */
export const adminListTriggerEvents = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { status?: string }) => ({ status: typeof d?.status === "string" ? d.status : "all" }))
  .handler(async ({ context, data }) => {
    await assertAdmin(context as never);
    let q = context.supabase
      .from("trigger_events")
      .select("id,board_id,trigger_name,source,status,reason,runs,created_at")
      .order("created_at", { ascending: false })
      .limit(300);
    if (["fired", "skipped", "failed"].includes(data.status)) q = q.eq("status", data.status);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    const ids = Array.from(new Set((rows ?? []).map((r) => r.board_id)));
    const titles = new Map<string, string>();
    if (ids.length) {
      const db = await admin();
      const { data: boards } = await db.from("boards").select("id,title").in("id", ids);
      for (const b of boards ?? []) titles.set(b.id, b.title);
    }
    return (rows ?? []).map((r) => ({
      id: r.id, scope: titles.get(r.board_id) ?? "Gelöschter Scope", name: r.trigger_name,
      source: r.source, status: r.status, reason: r.reason, runs: r.runs, createdAt: r.created_at,
    }));
  });
