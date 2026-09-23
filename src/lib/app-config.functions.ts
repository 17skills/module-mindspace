import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertAppRole } from "@/lib/app-permissions.server";
import { assertBoardRole } from "@/lib/guard.server";
import type { Json } from "@/integrations/supabase/types";

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

async function audit(actorId: string, action: string, appId: string) {
  const db = await admin();
  await db.from("audit_log").insert({ actor_id: actorId, subject_user_id: actorId, action, object_type: "app", object_id: appId });
}

const AppPayload = z.object({
  title: z.string().trim().min(1, "Titel fehlt").max(160),
  description: z.string().max(2000),
  kind: z.enum(["capture", "cockpit"]),
  nodeIds: z.array(z.string().uuid()).min(1).max(5),
  mcpScope: z.enum(["read", "write"]),
  channels: z.object({ web: z.boolean(), teams: z.boolean(), mcp: z.boolean() }),
  audience: z.string().trim().min(1, "Zielgruppe fehlt").max(200),
  leadQuestion: z.string().trim().min(1, "Leitfrage fehlt").max(500),
  branding: z.record(z.string(), z.unknown()),
});

export const saveDeliveredApp = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ appId: z.string().uuid().nullable(), boardId: z.string().uuid(), app: AppPayload }).parse(input))
  .handler(async ({ data, context }) => {
    const db = await admin();
    if (data.appId) await assertAppRole(context.userId, data.appId, "config_admin");
    else await assertBoardRole(context.userId, data.boardId, "editor");
    const payload = {
      title: data.app.title,
      description: data.app.description,
      kind: data.app.kind,
      node_ids: data.app.nodeIds,
      mcp_scope: data.app.mcpScope,
      channels: data.app.channels,
      audience: data.app.audience,
      lead_question: data.app.leadQuestion,
      branding: data.app.branding as Json,
      updated_at: new Date().toISOString(),
    };
    if (data.appId) {
      const { error } = await db.from("apps").update(payload).eq("id", data.appId);
      if (error) throw new Error(error.message);
      await audit(context.userId, "app.configuration_updated", data.appId);
      return { id: data.appId };
    }
    const { data: board } = await db.from("boards").select("org_id").eq("id", data.boardId).single();
    if (!board) throw new Error("Scope nicht gefunden");
    const { data: row, error } = await db.from("apps").insert({
      user_id: context.userId,
      board_id: data.boardId,
      org_id: board.org_id,
      ...payload,
    }).select("id").single();
    if (error) throw new Error(error.message);
    await audit(context.userId, "app.created", row.id);
    return { id: row.id };
  });

export const setDeliveredAppPublished = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ appId: z.string().uuid(), published: z.boolean() }).parse(input))
  .handler(async ({ data, context }) => {
    await assertAppRole(context.userId, data.appId, "config_admin");
    const db = await admin();
    const { error } = await db.from("apps").update({ is_public: data.published, updated_at: new Date().toISOString() }).eq("id", data.appId);
    if (error) throw new Error(error.message);
    await audit(context.userId, data.published ? "app.published" : "app.unpublished", data.appId);
    return { ok: true };
  });

export const deleteDeliveredApp = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ appId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await assertAppRole(context.userId, data.appId, "config_admin");
    await audit(context.userId, "app.deleted", data.appId);
    const db = await admin();
    const { error } = await db.from("apps").delete().eq("id", data.appId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });