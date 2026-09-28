import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertBoardRole } from "@/lib/guard.server";
import { readPrivacyMode } from "@/lib/pii";

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

/** Aktueller Datenschutz-Modus eines Scopes (Standard: streng). */
export const getPrivacyMode = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ boardId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: board } = await context.supabase
      .from("boards")
      .select("rules")
      .eq("id", data.boardId)
      .maybeSingle();
    return { mode: readPrivacyMode(board?.rules) };
  });

/** Nur Inhaber ändern den Modus; jede Änderung (besonders „Aus“) wird protokolliert. */
export const setPrivacyMode = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({ boardId: z.string().uuid(), mode: z.enum(["strict", "secrets", "off"]) })
      .parse(input),
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
    const before = readPrivacyMode(board.rules);
    const rules = { ...((board.rules as Record<string, unknown>) ?? {}), privacy: data.mode };
    const { error: upd } = await db.from("boards").update({ rules: rules as never }).eq("id", data.boardId);
    if (upd) throw new Error("Speichern fehlgeschlagen");
    await db.from("audit_log").insert({
      actor_id: context.userId,
      action: data.mode === "off" ? "privacy_filter_disabled" : "privacy_mode_changed",
      object_type: "board",
      object_id: data.boardId,
      detail: `${before} → ${data.mode}`,
    });
    return { mode: data.mode };
  });
