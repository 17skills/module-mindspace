import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertBoardRole } from "@/lib/guard.server";
import { GovernanceSchema, readGovernance } from "@/lib/governance";

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

/** Aktuelle Governance-Angaben eines Scopes. */
export const getGovernance = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ boardId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: board } = await context.supabase
      .from("boards")
      .select("rules")
      .eq("id", data.boardId)
      .maybeSingle();
    return readGovernance(board?.rules);
  });

/** Nur Inhaber ändern die Einstufung; jede Änderung wird protokolliert. */
export const setGovernance = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ boardId: z.string().uuid(), governance: GovernanceSchema }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertBoardRole(context.userId, data.boardId, "owner");
    const db = await admin();
    const { data: board, error } = await db
      .from("boards")
      .select("rules")
      .eq("id", data.boardId)
      .single();
    if (error) throw new Error("Scope nicht gefunden");
    const before = readGovernance(board.rules);
    const rules = {
      ...((board.rules as Record<string, unknown>) ?? {}),
      governance: data.governance,
    };
    const { error: upd } = await db.from("boards").update({ rules: rules as never }).eq("id", data.boardId);
    if (upd) throw new Error("Speichern fehlgeschlagen");
    await db.from("audit_log").insert({
      actor_id: context.userId,
      action: "governance_changed",
      object_type: "board",
      object_id: data.boardId,
      detail: `Risiko ${before.riskTier} → ${data.governance.riskTier}, Status ${before.lifecycle} → ${data.governance.lifecycle}`,
    });
    return data.governance;
  });

/** Alle sichtbaren Scopes mit Einstufung (RLS entscheidet die Sichtbarkeit). */
export const listGovernance = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("boards")
      .select("id, title, project, rules, updated_at")
      .order("updated_at", { ascending: false })
      .limit(500);
    if (error) throw new Error("Scopes konnten nicht geladen werden");
    return (data ?? []).map((b) => ({
      id: b.id,
      title: b.title,
      project: b.project,
      updatedAt: b.updated_at,
      governance: readGovernance(b.rules),
    }));
  });

/** Daten für den Governance-Nachweis: Einstufung plus relevante Audit-Einträge. */
export const getGovernanceEvidence = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ boardId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await assertBoardRole(context.userId, data.boardId, "viewer");
    const db = await admin();
    const { data: board } = await db
      .from("boards")
      .select("title, rules, updated_at")
      .eq("id", data.boardId)
      .single();
    if (!board) throw new Error("Scope nicht gefunden");
    const { data: audit } = await db
      .from("audit_log")
      .select("action, detail, created_at, actor_id")
      .eq("object_id", data.boardId)
      .order("created_at", { ascending: false })
      .limit(100);
    const ids = [...new Set((audit ?? []).map((a) => a.actor_id).filter(Boolean))] as string[];
    const { data: people } = ids.length
      ? await db.from("profiles").select("id, email").in("id", ids)
      : { data: [] as { id: string; email: string | null }[] };
    const mail = new Map((people ?? []).map((p) => [p.id, p.email ?? ""]));
    const rules = (board.rules ?? {}) as Record<string, unknown>;
    return {
      title: board.title,
      privacy: typeof rules["privacy"] === "string" ? (rules["privacy"] as string) : "strict",
      governance: readGovernance(board.rules),
      audit: (audit ?? []).map((a) => ({
        action: a.action,
        detail: a.detail ?? "",
        at: a.created_at,
        actor: a.actor_id ? mail.get(a.actor_id) || "unbekannt" : "System",
      })),
    };
  });
