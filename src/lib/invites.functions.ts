import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

async function audit(entry: {
  actorId: string;
  action: string;
  subjectUserId?: string | null;
  objectType?: string;
  objectId?: string;
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

function linkFor(token: string, origin: string) {
  return `${origin.replace(/\/$/, "")}/einladung/${token}`;
}

async function deliver(inviteId: string, origin: string, actorId: string) {
  const db = await admin();
  const { data: invite } = await db
    .from("invites")
    .select("id,token,email,org_id,board_id")
    .eq("id", inviteId)
    .maybeSingle();
  if (!invite) throw new Error("Einladung nicht gefunden");

  const [org, board, actor] = await Promise.all([
    invite.org_id
      ? db.from("organizations").select("name").eq("id", invite.org_id).maybeSingle()
      : Promise.resolve({ data: null }),
    invite.board_id
      ? db.from("boards").select("title,org_id").eq("id", invite.board_id).maybeSingle()
      : Promise.resolve({ data: null }),
    db.from("profiles").select("display_name,email").eq("id", actorId).maybeSingle(),
  ]);

  let orgName = (org.data as { name?: string } | null)?.name ?? "";
  if (!orgName && (board.data as { org_id?: string } | null)?.org_id) {
    const { data } = await db
      .from("organizations")
      .select("name")
      .eq("id", (board.data as { org_id: string }).org_id)
      .maybeSingle();
    orgName = data?.name ?? "";
  }

  const { sendInviteEmail } = await import("@/lib/invite-email.server");
  const link = linkFor(invite.token, origin);
  const sent = await sendInviteEmail({
    to: invite.email,
    inviterName: actor.data?.display_name || actor.data?.email || "Ein Teammitglied",
    orgName: orgName || "scopebuilder",
    scopeTitle: (board.data as { title?: string } | null)?.title ?? null,
    link,
  });
  if (sent) await db.from("invites").update({ email_sent_at: new Date().toISOString() }).eq("id", inviteId);
  return { sent, link };
}

/** Einladung erstellen und per E-Mail verschicken. */
export const createInvite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({
        orgId: z.string().uuid().optional(),
        boardId: z.string().uuid().optional(),
        teamId: z.string().uuid().nullable().default(null),
        emails: z.array(z.string().trim().email()).min(1).max(25),
        orgRole: z.enum(["admin", "member", "guest"]).default("member"),
        boardRole: z.enum(["viewer", "editor"]).default("viewer"),
        origin: z.string().url(),
      })
      .refine((value) => value.orgId || value.boardId, { message: "Ziel fehlt" })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    if (data.orgId) {
      const { assertOrgRole } = await import("@/lib/org-guard.server");
      await assertOrgRole(context.userId, data.orgId, "admin");
    }
    if (data.boardId) {
      const { assertBoardRole } = await import("@/lib/guard.server");
      await assertBoardRole(context.userId, data.boardId, "owner");
    }

    const db = await admin();
    const results: { email: string; sent: boolean; link: string }[] = [];
    for (const email of data.emails) {
      const { data: created, error } = await db
        .from("invites")
        .insert({
          org_id: data.orgId ?? null,
          board_id: data.boardId ?? null,
          team_id: data.teamId,
          email: email.toLowerCase(),
          org_role: data.orgRole,
          board_role: data.boardRole,
          invited_by: context.userId,
        })
        .select("id")
        .single();
      if (error || !created) throw new Error(error?.message ?? "Einladung fehlgeschlagen");
      const delivery = await deliver(created.id, data.origin, context.userId);
      results.push({ email, ...delivery });
      await audit({
        actorId: context.userId,
        action: "invite.created",
        objectType: data.orgId ? "org" : "board",
        objectId: data.orgId ?? data.boardId,
        detail: email,
      });
    }
    return { results };
  });

/** Einladung erneut senden. */
export const resendInvite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z.object({ inviteId: z.string().uuid(), origin: z.string().url() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const db = await admin();
    const { data: invite } = await db
      .from("invites")
      .select("org_id,board_id,status")
      .eq("id", data.inviteId)
      .maybeSingle();
    if (!invite) throw new Error("Einladung nicht gefunden");
    if (invite.org_id) {
      const { assertOrgRole } = await import("@/lib/org-guard.server");
      await assertOrgRole(context.userId, invite.org_id, "admin");
    } else if (invite.board_id) {
      const { assertBoardRole } = await import("@/lib/guard.server");
      await assertBoardRole(context.userId, invite.board_id, "owner");
    }
    await db
      .from("invites")
      .update({ status: "pending", expires_at: new Date(Date.now() + 14 * 86_400_000).toISOString() })
      .eq("id", data.inviteId);
    return deliver(data.inviteId, data.origin, context.userId);
  });

/** Einladung zurückziehen. */
export const revokeInvite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ inviteId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const db = await admin();
    const { data: invite } = await db
      .from("invites")
      .select("org_id,board_id,email")
      .eq("id", data.inviteId)
      .maybeSingle();
    if (!invite) throw new Error("Einladung nicht gefunden");
    if (invite.org_id) {
      const { assertOrgRole } = await import("@/lib/org-guard.server");
      await assertOrgRole(context.userId, invite.org_id, "admin");
    } else if (invite.board_id) {
      const { assertBoardRole } = await import("@/lib/guard.server");
      await assertBoardRole(context.userId, invite.board_id, "owner");
    }
    await db.from("invites").update({ status: "revoked" }).eq("id", data.inviteId);
    await audit({
      actorId: context.userId,
      action: "invite.revoked",
      objectType: invite.org_id ? "org" : "board",
      objectId: invite.org_id ?? invite.board_id ?? undefined,
      detail: invite.email,
    });
    return { ok: true };
  });

/** Öffentliche Vorschau einer Einladung (nur Zieltitel und Status). */
export const previewInvite = createServerFn({ method: "POST" })
  .validator((input: unknown) => z.object({ token: z.string().min(10).max(120) }).parse(input))
  .handler(async ({ data }) => {
    const db = await admin();
    const { data: invite } = await db
      .from("invites")
      .select("id,org_id,board_id,email,org_role,board_role,status,expires_at")
      .eq("token", data.token)
      .maybeSingle();
    if (!invite) return { valid: false as const, reason: "Diese Einladung gibt es nicht." };
    if (invite.status === "revoked") return { valid: false as const, reason: "Diese Einladung wurde zurückgezogen." };
    if (invite.status === "accepted") return { valid: false as const, reason: "Diese Einladung wurde bereits angenommen." };
    if (new Date(invite.expires_at).getTime() < Date.now()) {
      return { valid: false as const, reason: "Diese Einladung ist abgelaufen." };
    }
    const [org, board] = await Promise.all([
      invite.org_id
        ? db.from("organizations").select("name").eq("id", invite.org_id).maybeSingle()
        : Promise.resolve({ data: null }),
      invite.board_id
        ? db.from("boards").select("title").eq("id", invite.board_id).maybeSingle()
        : Promise.resolve({ data: null }),
    ]);
    return {
      valid: true as const,
      email: invite.email,
      orgName: (org.data as { name?: string } | null)?.name ?? null,
      scopeTitle: (board.data as { title?: string } | null)?.title ?? null,
      role: invite.org_id ? (invite.org_role as string) : (invite.board_role as string),
    };
  });

/** Einladung annehmen – nur mit passender E-Mail-Adresse. */
export const acceptInvite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ token: z.string().min(10).max(120) }).parse(input))
  .handler(async ({ data, context }) => {
    const db = await admin();
    const { data: invite } = await db
      .from("invites")
      .select("id,org_id,board_id,team_id,email,org_role,board_role,status,expires_at")
      .eq("token", data.token)
      .maybeSingle();
    if (!invite) throw new Error("Diese Einladung gibt es nicht.");
    if (invite.status !== "pending") throw new Error("Diese Einladung ist nicht mehr gültig.");
    if (new Date(invite.expires_at).getTime() < Date.now()) throw new Error("Diese Einladung ist abgelaufen.");

    const { data: profile } = await db.from("profiles").select("email").eq("id", context.userId).maybeSingle();
    const myEmail = (profile?.email ?? "").toLowerCase();
    if (myEmail !== invite.email.toLowerCase()) {
      throw new Error(`Diese Einladung gilt für ${invite.email}. Bitte mit dieser Adresse anmelden.`);
    }

    if (invite.org_id) {
      await db
        .from("organization_members")
        .upsert(
          { org_id: invite.org_id, user_id: context.userId, role: invite.org_role },
          { onConflict: "org_id,user_id" },
        );
      if (invite.team_id) {
        await db
          .from("team_members")
          .upsert({ team_id: invite.team_id, user_id: context.userId }, { onConflict: "team_id,user_id" });
      }
    }
    if (invite.board_id) {
      await db
        .from("board_members")
        .upsert(
          { board_id: invite.board_id, user_id: context.userId, role: invite.board_role },
          { onConflict: "board_id,user_id" },
        );
    }

    await db.from("invites").update({ status: "accepted" }).eq("id", invite.id);
    await audit({
      actorId: context.userId,
      subjectUserId: context.userId,
      action: "invite.accepted",
      objectType: invite.org_id ? "org" : "board",
      objectId: invite.org_id ?? invite.board_id ?? undefined,
    });
    return { orgId: invite.org_id, boardId: invite.board_id };
  });
