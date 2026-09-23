import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { ASSIGNABLE_ROLES, type AccessRole } from "@/lib/permissions";

const SubjectType = z.enum(["default", "user", "team"]);
const RoleInput = z.enum(["viewer", "commenter", "editor"]);

/**
 * Rechte im ganzen Scope: die eigene Scope-Rolle plus alle Module,
 * für die eine abweichende (engere) Regel gilt.
 */
export const getBoardAccess = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ boardId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { boardRoleOf, nodeRoleMap } = await import("@/lib/guard.server");
    const role = await boardRoleOf(context.userId, data.boardId);
    if (!role) throw new Error("Kein Zugriff auf diesen Scope");
    const nodes = await nodeRoleMap(context.userId, data.boardId, role);
    return { role: role as AccessRole, nodes };
  });

/** Regeln, Mitglieder und Teams für ein einzelnes Modul oder Hintergrundfeld. */
export const listNodeAccess = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z.object({ boardId: z.string().uuid(), nodeId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { assertBoardRole } = await import("@/lib/guard.server");
    const role = await assertBoardRole(context.userId, data.boardId, "viewer");
    const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");

    const [rulesRes, membersRes, boardRes, teamAccessRes] = await Promise.all([
      db
        .from("node_permissions")
        .select("id,subject_type,subject_id,role")
        .eq("node_id", data.nodeId),
      db.from("board_members").select("user_id,role").eq("board_id", data.boardId),
      db.from("boards").select("user_id,org_id").eq("id", data.boardId).maybeSingle(),
      db.from("board_team_access").select("team_id,role").eq("board_id", data.boardId),
    ]);

    const userIds = new Set<string>((membersRes.data ?? []).map((row) => row.user_id));
    if (boardRes.data?.user_id) userIds.add(boardRes.data.user_id);
    const profiles = userIds.size
      ? (await db.from("profiles").select("id,email,display_name").in("id", [...userIds])).data ?? []
      : [];
    const nameOf = new Map(
      profiles.map((p) => [p.id, p.display_name || p.email || "Unbekannt"] as const),
    );

    const teamIds = (teamAccessRes.data ?? []).map((row) => row.team_id);
    const teams = teamIds.length
      ? (await db.from("teams").select("id,name").in("id", teamIds)).data ?? []
      : [];
    const teamName = new Map(teams.map((t) => [t.id, t.name] as const));

    return {
      canManage: role === "owner" || role === "editor",
      myRole: role as AccessRole,
      members: [...userIds]
        .filter((id) => id !== boardRes.data?.user_id)
        .map((id) => ({ userId: id, name: nameOf.get(id) ?? "Unbekannt" })),
      teams: teams.map((team) => ({ id: team.id, name: team.name })),
      rules: (rulesRes.data ?? []).map((row) => ({
        id: row.id,
        subjectType: row.subject_type as "default" | "user" | "team",
        subjectId: row.subject_id,
        role: row.role as AccessRole,
        label:
          row.subject_type === "default"
            ? "Alle anderen Beteiligten"
            : row.subject_type === "team"
              ? `Team · ${teamName.get(row.subject_id ?? "") ?? "Unbekannt"}`
              : (nameOf.get(row.subject_id ?? "") ?? "Unbekannt"),
      })),
    };
  });

/** Regel setzen oder mit "none" wieder entfernen. Nur mit Bearbeitungsrecht. */
export const setNodeAccess = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({
        boardId: z.string().uuid(),
        nodeId: z.string().uuid(),
        subjectType: SubjectType,
        subjectId: z.string().uuid().nullable().default(null),
        role: z.union([RoleInput, z.literal("none")]),
      })
      .refine((value) => value.subjectType === "default" || value.subjectId !== null, {
        message: "Bitte Person oder Team wählen",
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { assertBoardRole } = await import("@/lib/guard.server");
    await assertBoardRole(context.userId, data.boardId, "editor");
    const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");

    const { data: node } = await db
      .from("nodes")
      .select("id")
      .eq("id", data.nodeId)
      .eq("board_id", data.boardId)
      .maybeSingle();
    if (!node) throw new Error("Dieses Modul gehört nicht zu diesem Scope");

    let query = db
      .from("node_permissions")
      .delete()
      .eq("node_id", data.nodeId)
      .eq("subject_type", data.subjectType);
    query = data.subjectId ? query.eq("subject_id", data.subjectId) : query.is("subject_id", null);
    await query;

    if (data.role !== "none") {
      if (!ASSIGNABLE_ROLES.includes(data.role)) throw new Error("Unbekannte Rolle");
      const { error } = await db.from("node_permissions").insert({
        board_id: data.boardId,
        node_id: data.nodeId,
        subject_type: data.subjectType,
        subject_id: data.subjectId,
        role: data.role,
        created_by: context.userId,
      });
      if (error) throw new Error(error.message);
    }

    await db.from("audit_log").insert({
      actor_id: context.userId,
      subject_user_id: data.subjectType === "user" ? data.subjectId : context.userId,
      action: "node.access_changed",
      object_type: "node",
      object_id: data.nodeId,
      detail: `${data.subjectType}:${data.subjectId ?? "-"}:${data.role}`,
    });
    return { ok: true };
  });

/** Kommentare eines Moduls, neueste zuletzt. */
export const listNodeComments = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z.object({ boardId: z.string().uuid(), nodeId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { nodeRoleOf } = await import("@/lib/guard.server");
    const role = await nodeRoleOf(context.userId, data.nodeId);
    if (!role) throw new Error("Kein Zugriff auf dieses Modul");
    const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
    const { data: rows, error } = await db
      .from("node_comments")
      .select("id,user_id,body,created_at,resolved_at")
      .eq("node_id", data.nodeId)
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);

    const ids = [...new Set((rows ?? []).map((row) => row.user_id))];
    const profiles = ids.length
      ? (await db.from("profiles").select("id,email,display_name").in("id", ids)).data ?? []
      : [];
    const nameOf = new Map(
      profiles.map((p) => [p.id, p.display_name || p.email || "Unbekannt"] as const),
    );
    return {
      role: role as AccessRole,
      comments: (rows ?? []).map((row) => ({
        id: row.id,
        body: row.body,
        createdAt: row.created_at,
        resolvedAt: row.resolved_at,
        mine: row.user_id === context.userId,
        author: nameOf.get(row.user_id) ?? "Unbekannt",
      })),
    };
  });

/** Kommentar schreiben – ab dem Recht "Kommentieren". */
export const addNodeComment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({
        boardId: z.string().uuid(),
        nodeId: z.string().uuid(),
        body: z.string().trim().min(1).max(4000),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { assertNodeRole } = await import("@/lib/guard.server");
    await assertNodeRole(context.userId, data.nodeId, "commenter");
    const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
    const { error } = await db.from("node_comments").insert({
      board_id: data.boardId,
      node_id: data.nodeId,
      user_id: context.userId,
      body: data.body,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Eigenen Kommentar löschen – Scope-Inhaber dürfen alle löschen. */
export const deleteNodeComment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ commentId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
    const { data: row } = await db
      .from("node_comments")
      .select("id,user_id,board_id")
      .eq("id", data.commentId)
      .maybeSingle();
    if (!row) return { ok: true };
    if (row.user_id !== context.userId) {
      const { assertBoardRole } = await import("@/lib/guard.server");
      await assertBoardRole(context.userId, row.board_id, "owner");
    }
    await db.from("node_comments").delete().eq("id", data.commentId);
    return { ok: true };
  });
