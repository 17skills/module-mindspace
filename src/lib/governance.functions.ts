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
