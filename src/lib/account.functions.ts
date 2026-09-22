import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { settingsFrom, type UserSettings } from "@/lib/settings";

const GRACE_DAYS = 7;

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

/** Datensparsames Protokoll: wer hat wann was getan – ohne IP und ohne Standort. */
async function audit(entry: {
  actorId: string | null;
  action: string;
  objectType?: string;
  objectId?: string;
  subjectUserId?: string | null;
  detail?: string;
}) {
  const db = await admin();
  await db.from("audit_log").insert({
    actor_id: entry.actorId,
    subject_user_id: entry.subjectUserId ?? entry.actorId,
    action: entry.action,
    object_type: entry.objectType ?? null,
    object_id: entry.objectId ?? null,
    detail: entry.detail ?? null,
  });
}

async function hardDelete(userId: string) {
  const db = await admin();
  await db.from("boards").delete().eq("user_id", userId);
  await db.from("board_members").delete().eq("user_id", userId);
  await db.from("apps").delete().eq("user_id", userId);
  await db.from("templates").delete().eq("user_id", userId);
  await db.from("module_library").delete().eq("user_id", userId);
  await db.from("user_consents").delete().eq("user_id", userId);
  await db.from("user_roles").delete().eq("user_id", userId);
  await db.from("profiles").delete().eq("id", userId);
  await db.from("audit_log").delete().eq("actor_id", userId);
  await db.auth.admin.deleteUser(userId);
}

/** Profil, Rolle, Einwilligungen und Kennzahlen des angemeldeten Kontos. */
export const getAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const db = await admin();
    const userId = context.userId;

    let { data: profile } = await db
      .from("profiles")
      .select("id,email,display_name,avatar_url,settings,blocked_at,deletion_requested_at,created_at")
      .eq("id", userId)
      .maybeSingle();

    if (!profile) {
      const email = (context.claims as { email?: string } | null)?.email ?? "";
      await db.from("profiles").insert({ id: userId, email, display_name: email.split("@")[0] ?? "" });
      const again = await db
        .from("profiles")
        .select("id,email,display_name,avatar_url,settings,blocked_at,deletion_requested_at,created_at")
        .eq("id", userId)
        .maybeSingle();
      profile = again.data;
    }

    // Vorgemerkte Löschung nach Ablauf der Widerrufsfrist endgültig ausführen.
    const requested = profile?.deletion_requested_at ? new Date(profile.deletion_requested_at) : null;
    if (requested && Date.now() - requested.getTime() > GRACE_DAYS * 86_400_000) {
      await hardDelete(userId);
      throw new Error("Dieses Konto wurde endgültig gelöscht.");
    }

    const [roles, consents, boards, memberships, apps] = await Promise.all([
      db.from("user_roles").select("role").eq("user_id", userId),
      db.from("user_consents").select("purpose,granted,updated_at").eq("user_id", userId),
      db.from("boards").select("id", { count: "exact", head: true }).eq("user_id", userId),
      db.from("board_members").select("id", { count: "exact", head: true }).eq("user_id", userId),
      db.from("apps").select("id", { count: "exact", head: true }).eq("user_id", userId),
    ]);

    // Erstes Konto der Installation wird Administrator, sonst wäre der Bereich für niemanden erreichbar.
    let isAdmin = (roles.data ?? []).some((row) => row.role === "admin");
    if (!isAdmin) {
      const { count } = await db
        .from("user_roles")
        .select("user_id", { count: "exact", head: true })
        .eq("role", "admin");
      if ((count ?? 0) === 0) {
        await db.from("user_roles").upsert(
          { user_id: userId, role: "admin" },
          { onConflict: "user_id,role" },
        );
        await audit({ actorId: userId, action: "role.admin_granted", objectType: "user", objectId: userId });
        isAdmin = true;
      }
    }

    return {
      id: userId,
      email: profile?.email ?? "",
      displayName: profile?.display_name ?? "",
      avatarUrl: profile?.avatar_url ?? null,
      createdAt: profile?.created_at ?? null,
      blocked: Boolean(profile?.blocked_at),
      deletionRequestedAt: profile?.deletion_requested_at ?? null,
      settings: settingsFrom(profile?.settings),
      isAdmin: (roles.data ?? []).some((row) => row.role === "admin"),
      consents: Object.fromEntries(
        (consents.data ?? []).map((row) => [row.purpose, { granted: row.granted, at: row.updated_at }]),
      ) as Record<string, { granted: boolean; at: string }>,
      counts: {
        boards: boards.count ?? 0,
        memberships: memberships.count ?? 0,
        apps: apps.count ?? 0,
      },
    };
  });

/** Anzeigename und Profilbild speichern. */
export const saveProfile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({
        displayName: z.string().trim().max(80),
        avatarUrl: z.string().max(400_000).nullable().default(null),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const db = await admin();
    const { error } = await db
      .from("profiles")
      .update({
        display_name: data.displayName,
        avatar_url: data.avatarUrl,
        updated_at: new Date().toISOString(),
      })
      .eq("id", context.userId);
    if (error) throw new Error(error.message);
    await audit({ actorId: context.userId, action: "profile.update", objectType: "profile" });
    return { ok: true };
  });

/** Persönliche Einstellungen speichern (gelten auf allen Geräten). */
export const saveSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z.object({ settings: z.record(z.string(), z.unknown()) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const db = await admin();
    const settings: UserSettings = settingsFrom(data.settings);
    const { error } = await db
      .from("profiles")
      .update({ settings, updated_at: new Date().toISOString() })
      .eq("id", context.userId);
    if (error) throw new Error(error.message);
    return { settings };
  });

/** Einwilligung erteilen oder widerrufen – mit Zeitpunkt und Version. */
export const setConsent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z.object({ purpose: z.string().min(2).max(60), granted: z.boolean() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const db = await admin();
    const { error } = await db.from("user_consents").upsert(
      {
        user_id: context.userId,
        purpose: data.purpose,
        granted: data.granted,
        version: "v1",
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,purpose" },
    );
    if (error) throw new Error(error.message);
    await audit({
      actorId: context.userId,
      action: data.granted ? "consent.granted" : "consent.revoked",
      objectType: "consent",
      objectId: data.purpose,
    });
    return { ok: true };
  });

/** Eigene Protokolleinträge (Transparenz nach Art. 15 DSGVO). */
export const listMyAuditLog = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("audit_log")
      .select("id,action,object_type,object_id,detail,created_at")
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw new Error(error.message);
    return data ?? [];
  });

/** Vollständiger Datenexport des eigenen Kontos (Datenübertragbarkeit, Art. 20). */
export const exportMyData = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const db = await admin();
    const userId = context.userId;
    const [profile, boards, memberships, apps, consents, log, library] = await Promise.all([
      db.from("profiles").select("*").eq("id", userId).maybeSingle(),
      db.from("boards").select("*").eq("user_id", userId),
      db.from("board_members").select("*").eq("user_id", userId),
      db.from("apps").select("*").eq("user_id", userId),
      db.from("user_consents").select("*").eq("user_id", userId),
      db.from("audit_log").select("*").eq("actor_id", userId),
      db.from("module_library").select("*").eq("user_id", userId),
    ]);

    const boardIds = (boards.data ?? []).map((board) => board.id);
    let nodes: Record<string, unknown>[] = [];
    let edges: Record<string, unknown>[] = [];
    if (boardIds.length) {
      const [n, e] = await Promise.all([
        db.from("nodes").select("*").in("board_id", boardIds),
        db.from("edges").select("*").in("board_id", boardIds),
      ]);
      nodes = n.data ?? [];
      edges = e.data ?? [];
    }

    await audit({ actorId: userId, action: "data.export" });

    return {
      exportedAt: new Date().toISOString(),
      profile: profile.data ?? null,
      scopes: boards.data ?? [],
      module: nodes,
      verbindungen: edges,
      mitgliedschaften: memberships.data ?? [],
      apps: apps.data ?? [],
      einwilligungen: consents.data ?? [],
      bibliothek: library.data ?? [],
      protokoll: log.data ?? [],
    };
  });

/** Kontolöschung vormerken – 7 Tage Widerrufsfrist. */
export const requestDeletion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const db = await admin();
    const at = new Date().toISOString();
    const { error } = await db
      .from("profiles")
      .update({ deletion_requested_at: at, updated_at: at })
      .eq("id", context.userId);
    if (error) throw new Error(error.message);
    await audit({ actorId: context.userId, action: "account.deletion_requested" });
    return { deletionRequestedAt: at };
  });

/** Vorgemerkte Löschung widerrufen. */
export const cancelDeletion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const db = await admin();
    const { error } = await db
      .from("profiles")
      .update({ deletion_requested_at: null, updated_at: new Date().toISOString() })
      .eq("id", context.userId);
    if (error) throw new Error(error.message);
    await audit({ actorId: context.userId, action: "account.deletion_cancelled" });
    return { ok: true };
  });

/** Konto sofort und endgültig löschen. */
export const deleteAccountNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ confirm: z.literal("LÖSCHEN") }).parse(input))
  .handler(async ({ context }) => {
    await audit({ actorId: context.userId, action: "account.deleted" });
    await hardDelete(context.userId);
    return { ok: true };
  });

/** Scopes des Kontos mit Mitgliederzahl – Grundlage der Mitgliederverwaltung. */
export const listMyScopes = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const db = await admin();
    const userId = context.userId;
    const [owned, joined] = await Promise.all([
      db.from("boards").select("id,title,created_at").eq("user_id", userId),
      db.from("board_members").select("board_id,role,created_at").eq("user_id", userId),
    ]);

    const joinedIds = (joined.data ?? []).map((row) => row.board_id);
    const joinedBoards = joinedIds.length
      ? (await db.from("boards").select("id,title").in("id", joinedIds)).data ?? []
      : [];

    const ownedIds = (owned.data ?? []).map((row) => row.id);
    const counts = new Map<string, number>();
    if (ownedIds.length) {
      const { data: rows } = await db.from("board_members").select("board_id").in("board_id", ownedIds);
      for (const row of rows ?? []) counts.set(row.board_id, (counts.get(row.board_id) ?? 0) + 1);
    }

    return {
      owned: (owned.data ?? []).map((board) => ({
        id: board.id,
        title: board.title,
        members: counts.get(board.id) ?? 0,
      })),
      joined: (joined.data ?? []).map((row) => ({
        id: row.board_id,
        title: joinedBoards.find((board) => board.id === row.board_id)?.title ?? "Scope",
        role: row.role,
        since: row.created_at,
      })),
    };
  });

/** App-Zugänge des Kontos inklusive Schlüssel und Rechten. */
export const listMyAppAccess = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("apps")
      .select("id,title,is_public,mcp_token,mcp_scope,updated_at,board_id")
      .order("updated_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

/** Zugangsschlüssel einer App neu erzeugen, Rechte setzen oder Zugang abschalten. */
export const updateAppAccess = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({
        appId: z.string().uuid(),
        regenerate: z.boolean().default(false),
        scope: z.enum(["read", "write"]).optional(),
        isPublic: z.boolean().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const patch: {
      updated_at: string;
      mcp_token?: string;
      mcp_scope?: string;
      is_public?: boolean;
    } = { updated_at: new Date().toISOString() };
    if (data.regenerate) {
      patch['mcp_token'] = crypto.randomUUID().replaceAll("-", "");
    }
    if (data.scope) patch['mcp_scope'] = data.scope;
    if (typeof data.isPublic === "boolean") patch['is_public'] = data.isPublic;

    const { data: row, error } = await context.supabase
      .from("apps")
      .update(patch)
      .eq("id", data.appId)
      .eq("user_id", context.userId)
      .select("id,mcp_token,mcp_scope,is_public")
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) throw new Error("App nicht gefunden");
    await audit({
      actorId: context.userId,
      action: data.regenerate ? "app.token_rotated" : "app.access_updated",
      objectType: "app",
      objectId: data.appId,
    });
    return row;
  });
