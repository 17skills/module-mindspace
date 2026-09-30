import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertBoardRole } from "@/lib/guard.server";
import {
  evaluateTrigger,
  parseConditions,
  TRIGGER_OPERATORS,
} from "@/lib/trigger-conditions";

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

const SELECT =
  "id,board_id,node_id,name,mode,enabled,prefix,interval_minutes,probe_url,match_mode,conditions,last_status,last_detail,last_event_at,last_run_at,next_run_at,created_at";

const ConditionSchema = z.object({
  path: z.string().max(200),
  op: z.enum(TRIGGER_OPERATORS),
  value: z.union([z.string().max(200), z.number()]).optional(),
});

const SaveSchema = z.object({
  id: z.string().uuid().optional(),
  boardId: z.string().uuid(),
  nodeId: z.string().uuid(),
  name: z.string().max(80).default(""),
  mode: z.enum(["webhook", "cron", "hybrid"]).default("webhook"),
  enabled: z.boolean().default(true),
  intervalMinutes: z.number().int().min(5).max(10_080).nullable().default(null),
  probeUrl: z.string().max(500).nullable().default(null),
  matchMode: z.enum(["any", "all"]).default("any"),
  conditions: z.array(ConditionSchema).max(20).default([]),
});

/** Alle Auslöser eines Scopes. */
export const listTriggers = createServerFn({ method: "POST" })
  .validator((input: unknown) => z.object({ boardId: z.string().uuid() }).parse(input))
  .middleware([requireSupabaseAuth])
  .handler(async ({ data, context }) => {
    await assertBoardRole(context.userId, data.boardId, "editor");
    const db = await admin();
    const { data: rows } = await db
      .from("scope_triggers")
      .select(SELECT)
      .eq("board_id", data.boardId)
      .order("created_at", { ascending: false })
      .limit(50);
    return rows ?? [];
  });

/** Auslöser anlegen oder ändern. Beim Anlegen wird der Schlüssel genau einmal gezeigt. */
export const saveTrigger = createServerFn({ method: "POST" })
  .validator((input: unknown) => SaveSchema.parse(input))
  .middleware([requireSupabaseAuth])
  .handler(async ({ data, context }) => {
    await assertBoardRole(context.userId, data.boardId, "owner");
    const db = await admin();
    const { newTriggerSecret, hashTriggerSecret } = await import("@/lib/triggers.server");

    const wantsSchedule = data.mode !== "webhook" && data.intervalMinutes;
    const fields = {
      name: data.name || "Auslöser",
      mode: data.mode,
      enabled: data.enabled,
      interval_minutes: data.mode === "webhook" ? null : data.intervalMinutes,
      probe_url: data.probeUrl?.trim() ? data.probeUrl.trim() : null,
      match_mode: data.matchMode,
      conditions: parseConditions(data.conditions) as never,
      next_run_at: wantsSchedule
        ? new Date(Date.now() + (data.intervalMinutes ?? 60) * 60_000).toISOString()
        : null,
    };

    if (data.id) {
      const { data: row, error } = await db
        .from("scope_triggers")
        .update(fields)
        .eq("id", data.id)
        .eq("board_id", data.boardId)
        .select(SELECT)
        .single();
      if (error) throw new Error("Auslöser konnte nicht gespeichert werden.");
      return { trigger: row, secret: null as string | null };
    }

    const secret = newTriggerSecret();
    const { data: row, error } = await db
      .from("scope_triggers")
      .insert({
        ...fields,
        board_id: data.boardId,
        node_id: data.nodeId,
        created_by: context.userId,
        secret_hash: await hashTriggerSecret(secret),
        prefix: secret.slice(0, 12),
      })
      .select(SELECT)
      .single();
    if (error) throw new Error("Auslöser konnte nicht angelegt werden.");
    return { trigger: row, secret };
  });

/** Neuen Schlüssel erzeugen; der alte gilt sofort nicht mehr. */
export const rotateTriggerSecret = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z.object({ id: z.string().uuid(), boardId: z.string().uuid() }).parse(input),
  )
  .middleware([requireSupabaseAuth])
  .handler(async ({ data, context }) => {
    await assertBoardRole(context.userId, data.boardId, "owner");
    const db = await admin();
    const { newTriggerSecret, hashTriggerSecret } = await import("@/lib/triggers.server");
    const secret = newTriggerSecret();
    const { error } = await db
      .from("scope_triggers")
      .update({ secret_hash: await hashTriggerSecret(secret), prefix: secret.slice(0, 12) })
      .eq("id", data.id)
      .eq("board_id", data.boardId);
    if (error) throw new Error("Schlüssel konnte nicht erneuert werden.");
    return { secret };
  });

export const deleteTrigger = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z.object({ id: z.string().uuid(), boardId: z.string().uuid() }).parse(input),
  )
  .middleware([requireSupabaseAuth])
  .handler(async ({ data, context }) => {
    await assertBoardRole(context.userId, data.boardId, "owner");
    const db = await admin();
    await db.from("scope_triggers").delete().eq("id", data.id).eq("board_id", data.boardId);
    return { ok: true };
  });

/** Probelauf der Regeln mit einer Beispielnachricht – startet nichts. */
export const testTrigger = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z
      .object({
        boardId: z.string().uuid(),
        payload: z.string().max(20_000),
        matchMode: z.enum(["any", "all"]).default("any"),
        conditions: z.array(ConditionSchema).max(20).default([]),
        previous: z
          .record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]))
          .default({}),
      })
      .parse(input),
  )
  .middleware([requireSupabaseAuth])
  .handler(async ({ data, context }) => {
    await assertBoardRole(context.userId, data.boardId, "editor");
    let payload: unknown;
    try {
      payload = JSON.parse(data.payload);
    } catch {
      throw new Error("Die Beispielnachricht ist kein gültiges JSON.");
    }
    return evaluateTrigger(
      parseConditions(data.conditions),
      payload,
      data.previous,
      data.matchMode,
    );
  });
