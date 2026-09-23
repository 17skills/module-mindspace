import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertAppRole, type AppAccessMode, type AppRole } from "@/lib/app-permissions.server";

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

async function audit(actorId: string, action: string, appId: string, detail?: string) {
  const db = await admin();
  await db.from("audit_log").insert({
    actor_id: actorId,
    subject_user_id: actorId,
    action,
    object_type: "app",
    object_id: appId,
    detail: detail ?? null,
  });
}

export const getAppAccessConfig = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ appId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await assertAppRole(context.userId, data.appId, "config_admin");
    const db = await admin();
    const { data: app } = await db.from("apps").select("id,org_id,access_mode").eq("id", data.appId).single();
    const [grants, members, teams] = await Promise.all([
      db.from("app_permissions").select("id,subject_type,subject_id,role").eq("app_id", data.appId),
      app.org_id
        ? db.from("organization_members").select("user_id,role").eq("org_id", app.org_id)
        : Promise.resolve({ data: [] }),
      app.org_id
        ? db.from("teams").select("id,name").eq("org_id", app.org_id).order("name")
        : Promise.resolve({ data: [] }),
    ]);
    const userIds = (members.data ?? []).map((row) => row.user_id);
    const { data: profiles } = userIds.length
      ? await db.from("profiles").select("id,email,display_name").in("id", userIds)
      : { data: [] };
    return {
      accessMode: app.access_mode as AppAccessMode,
      grants: grants.data ?? [],
      people: (members.data ?? []).map((member) => {
        const profile = (profiles ?? []).find((row) => row.id === member.user_id);
        return { id: member.user_id, name: profile?.display_name || profile?.email || "Mitglied", email: profile?.email ?? "", orgRole: member.role };
      }),
      teams: teams.data ?? [],
    };
  });

export const setAppAccessMode = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ appId: z.string().uuid(), mode: z.enum(["public", "org", "restricted"]) }).parse(input))
  .handler(async ({ data, context }) => {
    await assertAppRole(context.userId, data.appId, "config_admin");
    const db = await admin();
    const { error } = await db.from("apps").update({ access_mode: data.mode, updated_at: new Date().toISOString() }).eq("id", data.appId);
    if (error) throw new Error(error.message);
    await audit(context.userId, "app.access_mode_changed", data.appId, data.mode);
    return { ok: true, accessMode: data.mode as AppAccessMode };
  });

export const setAppPermission = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({
    appId: z.string().uuid(),
    subjectType: z.enum(["user", "team"]),
    subjectId: z.string().uuid(),
    role: z.enum(["viewer", "data_editor", "config_admin"]).nullable(),
  }).parse(input))
  .handler(async ({ data, context }) => {
    await assertAppRole(context.userId, data.appId, "config_admin");
    const db = await admin();
    if (data.role) {
      const { error } = await db.from("app_permissions").upsert({
        app_id: data.appId,
        subject_type: data.subjectType,
        subject_id: data.subjectId,
        role: data.role,
        created_by: context.userId,
      }, { onConflict: "app_id,subject_type,subject_id" });
      if (error) throw new Error(error.message);
    } else {
      const { error } = await db.from("app_permissions").delete()
        .eq("app_id", data.appId).eq("subject_type", data.subjectType).eq("subject_id", data.subjectId);
      if (error) throw new Error(error.message);
    }
    await audit(context.userId, data.role ? "app.permission_set" : "app.permission_removed", data.appId,
      `${data.subjectType}:${data.subjectId}:${data.role ?? "removed"}`);
    return { ok: true, role: data.role as AppRole | null };
  });