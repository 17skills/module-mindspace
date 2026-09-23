import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertBoardRole, assertActiveUser } from "@/lib/guard.server";

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

async function audit(entry: {
  actorId: string;
  action: string;
  objectId: string;
  detail?: string;
  subjectUserId?: string;
}) {
  const db = await admin();
  await db.from("audit_log").insert({
    actor_id: entry.actorId,
    subject_user_id: entry.subjectUserId ?? entry.actorId,
    action: entry.action,
    object_type: "board",
    object_id: entry.objectId,
    detail: entry.detail ?? null,
  });
}

async function limitGuests(suffix: string, limit: number, windowMs: number) {
  const { assertRate, callerKey } = await import("@/lib/rate-limit.server");
  let key = "anon";
  try {
    const request = getRequest();
    if (request) key = await callerKey(request);
  } catch {
    /* kein Request-Kontext */
  }
  assertRate(`${suffix}:${key}`, limit, windowMs);
}

/**
 * Scope plus Module für einen Gastlink. Ohne Anmeldung, aber mit Prüfung von
 * Widerruf, Ablaufdatum, optionalem Passwort und Aufrufbegrenzung.
 */
export const getSharedBoard = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z
      .object({ token: z.string().uuid(), password: z.string().max(200).optional() })
      .parse(input),
  )
  .handler(async ({ data }) => {
    await limitGuests("share", 60, 60_000);

    const db = await admin();
    const { data: board, error } = await db
      .from("boards")
      .select(
        "id,title,description,is_public,share_expires_at,share_revoked_at,share_password_hash",
      )
      .eq("share_token", data.token)
      .maybeSingle();
    if (error) throw new Error(error.message);

    const expired = board?.share_expires_at
      ? new Date(board.share_expires_at).getTime() < Date.now()
      : false;
    if (!board || !board.is_public || board.share_revoked_at || expired) {
      throw new Error("Dieser Link ist nicht (mehr) freigegeben");
    }

    if (board.share_password_hash) {
      if (!data.password) {
        return { locked: true as const, board: null, nodes: [], edges: [] };
      }
      await limitGuests("share-pass", 10, 60_000);
      const { verifySharePassword } = await import("@/lib/share-password.server");
      const ok = await verifySharePassword(data.password, board.share_password_hash);
      if (!ok) throw new Error("Passwort stimmt nicht");
    }

    const [nodeRes, edgeRes] = await Promise.all([
      db.from("nodes").select("*").eq("board_id", board.id),
      db.from("edges").select("*").eq("board_id", board.id),
    ]);
    if (nodeRes.error) throw new Error(nodeRes.error.message);
    if (edgeRes.error) throw new Error(edgeRes.error.message);

    await db
      .from("boards")
      .update({ share_last_used_at: new Date().toISOString() })
      .eq("id", board.id);

    return {
      locked: false as const,
      board: { id: board.id, title: board.title, description: board.description },
      nodes: nodeRes.data ?? [],
      edges: edgeRes.data ?? [],
    };
  });

/** Eigene Rolle in einem Scope: Inhaber, Bearbeiten oder Lesen. */
export const getBoardRole = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ boardId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { boardRoleOf } = await import("@/lib/guard.server");
    const role = await boardRoleOf(context.userId, data.boardId);
    return { role };
  });

/** Mitglieder eines Scopes. Für alle Beteiligten lesbar. */
export const listMembers = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ boardId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const role = await assertBoardRole(context.userId, data.boardId, "viewer");
    const db = await admin();
    const { data: rows, error } = await db
      .from("board_members")
      .select("id,user_id,role,created_at")
      .eq("board_id", data.boardId)
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);

    const ids = (rows ?? []).map((row) => row.user_id);
    const emails = new Map<string, string>();
    if (ids.length) {
      const { data: profiles } = await db.from("profiles").select("id,email").in("id", ids);
      for (const profile of profiles ?? []) emails.set(profile.id, profile.email ?? "");
    }
    return {
      role,
      members: (rows ?? []).map((row) => ({
        id: row.id,
        userId: row.user_id,
        role: row.role,
        email: emails.get(row.user_id) ?? "Unbekannt",
        createdAt: row.created_at,
      })),
    };
  });

/** Bestehendes Konto zu diesem Scope einladen. Nur Inhaber. */
export const addMember = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({
        boardId: z.string().uuid(),
        email: z.string().email(),
        role: z.enum(["viewer", "editor"]).default("viewer"),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertBoardRole(context.userId, data.boardId, "owner");
    const db = await admin();
    const email = data.email.trim().toLowerCase();
    const { data: profile } = await db
      .from("profiles")
      .select("id")
      .ilike("email", email)
      .maybeSingle();
    if (!profile) throw new Error("Für diese E-Mail gibt es noch kein Konto");
    if (profile.id === context.userId) throw new Error("Du bist bereits Inhaber dieses Scopes");
    const { error } = await db
      .from("board_members")
      .upsert(
        { board_id: data.boardId, user_id: profile.id, role: data.role },
        { onConflict: "board_id,user_id" },
      );
    if (error) throw new Error(error.message);
    await audit({
      actorId: context.userId,
      action: "member.added",
      objectId: data.boardId,
      subjectUserId: profile.id,
      detail: data.role,
    });
    return { email };
  });

/** Rolle eines Mitglieds ändern. Nur Inhaber. */
export const setMemberRole = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({
        boardId: z.string().uuid(),
        memberId: z.string().uuid(),
        role: z.enum(["viewer", "editor"]),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertBoardRole(context.userId, data.boardId, "owner");
    const db = await admin();
    const { data: row, error } = await db
      .from("board_members")
      .update({ role: data.role })
      .eq("id", data.memberId)
      .eq("board_id", data.boardId)
      .select("user_id")
      .maybeSingle();
    if (error) throw new Error(error.message);
    await audit({
      actorId: context.userId,
      action: "member.role_changed",
      objectId: data.boardId,
      subjectUserId: row?.user_id ?? context.userId,
      detail: data.role,
    });
    return { ok: true };
  });

/** Mitglied entfernen. Nur Inhaber. */
export const removeMember = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z.object({ boardId: z.string().uuid(), memberId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertBoardRole(context.userId, data.boardId, "owner");
    const db = await admin();
    const { data: row, error } = await db
      .from("board_members")
      .delete()
      .eq("id", data.memberId)
      .eq("board_id", data.boardId)
      .select("user_id")
      .maybeSingle();
    if (error) throw new Error(error.message);
    await audit({
      actorId: context.userId,
      action: "member.removed",
      objectId: data.boardId,
      subjectUserId: row?.user_id ?? context.userId,
    });
    return { ok: true };
  });

/** Zustand des Gastlinks: Freigabe, Ablauf, Passwortschutz, letzte Nutzung. */
export const getShareSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ boardId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await assertBoardRole(context.userId, data.boardId, "owner");
    const db = await admin();
    const { data: row, error } = await db
      .from("boards")
      .select(
        "share_token,is_public,share_expires_at,share_revoked_at,share_password_hash,share_last_used_at",
      )
      .eq("id", data.boardId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return {
      token: row?.share_token ?? null,
      isPublic: Boolean(row?.is_public),
      expiresAt: row?.share_expires_at ?? null,
      revokedAt: row?.share_revoked_at ?? null,
      hasPassword: Boolean(row?.share_password_hash),
      lastUsedAt: row?.share_last_used_at ?? null,
    };
  });

/** Gastlink einstellen: Freigabe, Ablaufdatum, Passwortschutz. Nur Inhaber. */
export const updateShareSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({
        boardId: z.string().uuid(),
        isPublic: z.boolean().optional(),
        expiresInDays: z.number().int().min(0).max(365).nullable().optional(),
        password: z.string().min(6).max(200).nullable().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertBoardRole(context.userId, data.boardId, "owner");
    const db = await admin();
    const patch: Record<string, unknown> = {};

    if (typeof data.isPublic === "boolean") {
      patch["is_public"] = data.isPublic;
      if (data.isPublic) patch["share_revoked_at"] = null;
    }
    if (data.expiresInDays !== undefined) {
      patch["share_expires_at"] =
        data.expiresInDays === null || data.expiresInDays === 0
          ? null
          : new Date(Date.now() + data.expiresInDays * 86_400_000).toISOString();
    }
    if (data.password !== undefined) {
      if (data.password === null) {
        patch["share_password_hash"] = null;
      } else {
        const { hashSharePassword } = await import("@/lib/share-password.server");
        patch["share_password_hash"] = await hashSharePassword(data.password);
      }
    }

    const { error } = await db
      .from("boards")
      .update(patch as never)
      .eq("id", data.boardId);
    if (error) throw new Error(error.message);
    await audit({
      actorId: context.userId,
      action: "share.updated",
      objectId: data.boardId,
      detail: Object.keys(patch).join(","),
    });
    return { ok: true };
  });

/** Gastlink sofort widerrufen. Nur Inhaber. */
export const revokeShare = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ boardId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await assertBoardRole(context.userId, data.boardId, "owner");
    const db = await admin();
    const { error } = await db
      .from("boards")
      .update({ is_public: false, share_revoked_at: new Date().toISOString() })
      .eq("id", data.boardId);
    if (error) throw new Error(error.message);
    await audit({ actorId: context.userId, action: "share.revoked", objectId: data.boardId });
    return { ok: true };
  });

/** Neuen Gastlink erzeugen; der alte wird dadurch ungültig. Nur Inhaber. */
export const rotateShareToken = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ boardId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await assertBoardRole(context.userId, data.boardId, "owner");
    const db = await admin();
    const token = crypto.randomUUID();
    const { error } = await db
      .from("boards")
      .update({ share_token: token, share_revoked_at: null, share_last_used_at: null })
      .eq("id", data.boardId);
    if (error) throw new Error(error.message);
    await audit({ actorId: context.userId, action: "share.rotated", objectId: data.boardId });
    return { token };
  });

/** Sicherheitsprüfung für Aufrufe, die kein Board betreffen. */
export const assertAccountActive = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertActiveUser(context.userId);
    return { ok: true };
  });
