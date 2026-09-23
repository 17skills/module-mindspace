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
  objectId?: string | null;
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

/** Organisationen des Kontos plus aktive Auswahl. */
export const listMyOrgs = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { organizationsOf, activeOrgOf } = await import("@/lib/org-guard.server");
    const orgs = await organizationsOf(context.userId);
    const active = await activeOrgOf(context.userId);
    return { orgs, activeOrgId: active?.id ?? null };
  });

/** Aktive Organisation wechseln. */
export const setActiveOrg = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ orgId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { assertOrgRole } = await import("@/lib/org-guard.server");
    await assertOrgRole(context.userId, data.orgId, "guest");
    const db = await admin();
    const { data: profile } = await db.from("profiles").select("settings").eq("id", context.userId).maybeSingle();
    const settings = { ...((profile?.settings as Record<string, unknown>) ?? {}), activeOrgId: data.orgId };
    await db.from("profiles").update({ settings }).eq("id", context.userId);
    return { ok: true };
  });

/** Organisation mit Mitgliedern, Teams und offenen Einladungen. */
export const getOrg = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z.object({ orgId: z.string().uuid().optional() }).default({}).parse(input ?? {}),
  )
  .handler(async ({ data, context }) => {
    const { assertOrgRole, activeOrgOf } = await import("@/lib/org-guard.server");
    const orgId = data.orgId ?? (await activeOrgOf(context.userId))?.id;
    if (!orgId) throw new Error("Keine Organisation gefunden");
    const myRole = await assertOrgRole(context.userId, orgId, "guest");

    const db = await admin();
    const [org, members, teams, teamMembers, invites] = await Promise.all([
      db.from("organizations").select("id,name,created_at").eq("id", orgId).maybeSingle(),
      db.from("organization_members").select("id,user_id,role,created_at").eq("org_id", orgId),
      db.from("teams").select("id,name,description,created_at").eq("org_id", orgId).order("name"),
      db.from("team_members").select("id,team_id,user_id"),
      db
        .from("invites")
        .select("id,email,org_role,board_role,status,expires_at,created_at,email_sent_at,token,team_id")
        .eq("org_id", orgId)
        .order("created_at", { ascending: false }),
    ]);

    const ids = (members.data ?? []).map((row) => row.user_id);
    const profiles = ids.length
      ? (await db.from("profiles").select("id,email,display_name,avatar_url,blocked_at,updated_at").in("id", ids)).data
      : [];
    const byId = new Map((profiles ?? []).map((p) => [p.id, p]));
    const teamIds = new Set((teams.data ?? []).map((t) => t.id));

    return {
      id: orgId,
      name: org.data?.name ?? "",
      createdAt: org.data?.created_at ?? null,
      myRole,
      canManage: myRole === "owner" || myRole === "admin",
      members: (members.data ?? []).map((row) => ({
        id: row.id,
        userId: row.user_id,
        role: row.role as string,
        joinedAt: row.created_at,
        email: byId.get(row.user_id)?.email ?? "",
        displayName: byId.get(row.user_id)?.display_name ?? "",
        avatarUrl: byId.get(row.user_id)?.avatar_url ?? null,
        blocked: Boolean(byId.get(row.user_id)?.blocked_at),
        teams: (teamMembers.data ?? [])
          .filter((tm) => tm.user_id === row.user_id && teamIds.has(tm.team_id))
          .map((tm) => tm.team_id),
      })),
      teams: (teams.data ?? []).map((team) => ({
        id: team.id,
        name: team.name,
        description: team.description,
        memberIds: (teamMembers.data ?? []).filter((tm) => tm.team_id === team.id).map((tm) => tm.user_id),
      })),
      invites: (invites.data ?? []).map((row) => ({
        id: row.id,
        email: row.email,
        role: row.org_role as string,
        status: row.status,
        expiresAt: row.expires_at,
        createdAt: row.created_at,
        emailSentAt: row.email_sent_at,
        token: row.token,
        teamId: row.team_id,
      })),
    };
  });

/** Name der Organisation ändern. */
export const renameOrg = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z.object({ orgId: z.string().uuid(), name: z.string().trim().min(2).max(80) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { assertOrgRole } = await import("@/lib/org-guard.server");
    await assertOrgRole(context.userId, data.orgId, "admin");
    const db = await admin();
    const { error } = await db.from("organizations").update({ name: data.name }).eq("id", data.orgId);
    if (error) throw new Error(error.message);
    await audit({ actorId: context.userId, action: "org.renamed", objectType: "org", objectId: data.orgId });
    return { ok: true };
  });

/** Rolle eines Mitglieds in der Organisation ändern. */
export const setOrgRole = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({
        orgId: z.string().uuid(),
        userId: z.string().uuid(),
        role: z.enum(["owner", "admin", "member", "guest"]),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { assertOrgRole } = await import("@/lib/org-guard.server");
    const myRole = await assertOrgRole(context.userId, data.orgId, "admin");
    if (data.role === "owner" && myRole !== "owner") {
      throw new Error("Nur Inhaber dürfen weitere Inhaber ernennen");
    }
    const db = await admin();
    const { data: owners } = await db
      .from("organization_members")
      .select("user_id")
      .eq("org_id", data.orgId)
      .eq("role", "owner");
    const ownerIds = (owners ?? []).map((row) => row.user_id);
    if (ownerIds.includes(data.userId) && data.role !== "owner" && ownerIds.length <= 1) {
      throw new Error("Die Organisation braucht mindestens einen Inhaber");
    }
    const { error } = await db
      .from("organization_members")
      .update({ role: data.role })
      .eq("org_id", data.orgId)
      .eq("user_id", data.userId);
    if (error) throw new Error(error.message);
    await audit({
      actorId: context.userId,
      subjectUserId: data.userId,
      action: "org.role_changed",
      objectType: "org",
      objectId: data.orgId,
      detail: data.role,
    });
    return { ok: true };
  });

/** Mitglied aus der Organisation entfernen. */
export const removeOrgMember = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z.object({ orgId: z.string().uuid(), userId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { assertOrgRole } = await import("@/lib/org-guard.server");
    await assertOrgRole(context.userId, data.orgId, "admin");
    const db = await admin();
    const { data: owners } = await db
      .from("organization_members")
      .select("user_id")
      .eq("org_id", data.orgId)
      .eq("role", "owner");
    const ownerIds = (owners ?? []).map((row) => row.user_id);
    if (ownerIds.includes(data.userId) && ownerIds.length <= 1) {
      throw new Error("Der letzte Inhaber kann nicht entfernt werden");
    }
    await db.from("organization_members").delete().eq("org_id", data.orgId).eq("user_id", data.userId);
    const { data: teams } = await db.from("teams").select("id").eq("org_id", data.orgId);
    const teamIds = (teams ?? []).map((row) => row.id);
    if (teamIds.length) {
      await db.from("team_members").delete().eq("user_id", data.userId).in("team_id", teamIds);
    }
    await audit({
      actorId: context.userId,
      subjectUserId: data.userId,
      action: "org.member_removed",
      objectType: "org",
      objectId: data.orgId,
    });
    return { ok: true };
  });

/** Organisation selbst verlassen. */
export const leaveOrg = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ orgId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { assertOrgRole } = await import("@/lib/org-guard.server");
    const role = await assertOrgRole(context.userId, data.orgId, "guest");
    const db = await admin();
    if (role === "owner") {
      const { count } = await db
        .from("organization_members")
        .select("user_id", { count: "exact", head: true })
        .eq("org_id", data.orgId)
        .eq("role", "owner");
      if ((count ?? 0) <= 1) throw new Error("Bitte zuerst einen anderen Inhaber bestimmen");
    }
    await db.from("organization_members").delete().eq("org_id", data.orgId).eq("user_id", context.userId);
    await audit({
      actorId: context.userId,
      subjectUserId: context.userId,
      action: "org.left",
      objectType: "org",
      objectId: data.orgId,
    });
    return { ok: true };
  });

/** Team anlegen, umbenennen oder löschen. */
export const saveTeam = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({
        orgId: z.string().uuid(),
        teamId: z.string().uuid().optional(),
        name: z.string().trim().min(2).max(80),
        description: z.string().trim().max(200).default(""),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { assertOrgRole } = await import("@/lib/org-guard.server");
    await assertOrgRole(context.userId, data.orgId, "admin");
    const db = await admin();
    if (data.teamId) {
      const { error } = await db
        .from("teams")
        .update({ name: data.name, description: data.description })
        .eq("id", data.teamId)
        .eq("org_id", data.orgId);
      if (error) throw new Error(error.message);
      return { id: data.teamId };
    }
    const { data: created, error } = await db
      .from("teams")
      .insert({ org_id: data.orgId, name: data.name, description: data.description })
      .select("id")
      .single();
    if (error || !created) throw new Error(error?.message ?? "Team konnte nicht angelegt werden");
    await audit({ actorId: context.userId, action: "team.created", objectType: "team", objectId: created.id });
    return { id: created.id };
  });

export const deleteTeam = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z.object({ orgId: z.string().uuid(), teamId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { assertOrgRole } = await import("@/lib/org-guard.server");
    await assertOrgRole(context.userId, data.orgId, "admin");
    const db = await admin();
    await db.from("teams").delete().eq("id", data.teamId).eq("org_id", data.orgId);
    await audit({ actorId: context.userId, action: "team.deleted", objectType: "team", objectId: data.teamId });
    return { ok: true };
  });

/** Konto in ein Team aufnehmen oder daraus entfernen. */
export const setTeamMember = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({
        orgId: z.string().uuid(),
        teamId: z.string().uuid(),
        userId: z.string().uuid(),
        member: z.boolean(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { assertOrgRole, orgRoleOf } = await import("@/lib/org-guard.server");
    await assertOrgRole(context.userId, data.orgId, "admin");
    if (!(await orgRoleOf(data.userId, data.orgId))) {
      throw new Error("Dieses Konto gehört nicht zur Organisation");
    }
    const db = await admin();
    if (data.member) {
      const { error } = await db
        .from("team_members")
        .upsert({ team_id: data.teamId, user_id: data.userId }, { onConflict: "team_id,user_id" });
      if (error) throw new Error(error.message);
    } else {
      await db.from("team_members").delete().eq("team_id", data.teamId).eq("user_id", data.userId);
    }
    await audit({
      actorId: context.userId,
      subjectUserId: data.userId,
      action: data.member ? "team.member_added" : "team.member_removed",
      objectType: "team",
      objectId: data.teamId,
    });
    return { ok: true };
  });

/** Team-Freigaben eines Scopes lesen und setzen (nur Scope-Inhaber). */
export const listBoardTeams = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ boardId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { assertBoardRole } = await import("@/lib/guard.server");
    await assertBoardRole(context.userId, data.boardId, "viewer");
    const db = await admin();
    const [board, access] = await Promise.all([
      db.from("boards").select("org_id").eq("id", data.boardId).maybeSingle(),
      db.from("board_team_access").select("id,team_id,role").eq("board_id", data.boardId),
    ]);
    const teams = board.data?.org_id
      ? (await db.from("teams").select("id,name").eq("org_id", board.data.org_id).order("name")).data
      : [];
    return {
      teams: (teams ?? []).map((team) => ({ id: team.id, name: team.name })),
      access: (access.data ?? []).map((row) => ({ id: row.id, teamId: row.team_id, role: row.role })),
    };
  });

export const setBoardTeamAccess = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({
        boardId: z.string().uuid(),
        teamId: z.string().uuid(),
        role: z.enum(["viewer", "editor", "none"]),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { assertBoardRole } = await import("@/lib/guard.server");
    await assertBoardRole(context.userId, data.boardId, "owner");
    const db = await admin();
    if (data.role === "none") {
      await db.from("board_team_access").delete().eq("board_id", data.boardId).eq("team_id", data.teamId);
    } else {
      const { error } = await db
        .from("board_team_access")
        .upsert(
          { board_id: data.boardId, team_id: data.teamId, role: data.role },
          { onConflict: "board_id,team_id" },
        );
      if (error) throw new Error(error.message);
    }
    await audit({
      actorId: context.userId,
      action: "board.team_access",
      objectType: "board",
      objectId: data.boardId,
      detail: `${data.teamId}:${data.role}`,
    });
    return { ok: true };
  });
