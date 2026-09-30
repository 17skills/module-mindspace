/**
 * Ausführung automatischer Auslöser (Webhook und Zeitplan) auf dem Server.
 *
 * Ein Auslöser prüft erst die Bedingungen und startet den Ablauf nur dann.
 * Greift keine Regel, wird das kostenneutral als „übersprungen" vermerkt:
 * kein Modellaufruf, kein Token, kein Durchlauf.
 */
import { evaluateTrigger, parseConditions, type TriggerEvaluation } from "@/lib/trigger-conditions";
import { safeUrl } from "@/lib/api-fetch.server";
import { withTimeout } from "@/lib/budget";

export type TriggerRow = {
  id: string;
  board_id: string;
  node_id: string;
  mode: string;
  enabled: boolean;
  interval_minutes: number | null;
  probe_url: string | null;
  match_mode: string;
  conditions: unknown;
  last_values: unknown;
};

export async function hashTriggerSecret(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(`scopebuilder-trigger:${value}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

export function newTriggerSecret(): string {
  const raw = Array.from(crypto.getRandomValues(new Uint8Array(24)), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
  return `sbt_${raw}`;
}

/** Holt die Vergleichsdaten eines Zeitplan-Auslösers (nur lesend, 15 s). */
export async function probePayload(url: string): Promise<unknown> {
  const target = safeUrl(url);
  const answer = await withTimeout(
    (signal) => fetch(target.toString(), { method: "GET", signal, headers: { accept: "application/json" } }),
    15_000,
  );
  const text = await answer.text();
  try {
    return JSON.parse(text);
  } catch {
    return { text };
  }
}

function previousValues(raw: unknown): Record<string, unknown> {
  return raw && typeof raw === "object" && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : {};
}

export type TriggerOutcome = {
  fired: boolean;
  evaluation: TriggerEvaluation;
  runs: number;
  error: string | null;
};

/**
 * Wertet einen Auslöser gegen eine Nachricht aus und startet bei Treffer den Ablauf.
 * Der Merkstand für den nächsten Vergleich wird immer fortgeschrieben.
 */
export async function fireTrigger(
  db: { from: (t: string) => any },
  row: TriggerRow,
  payload: unknown,
  actorLabel: string,
): Promise<TriggerOutcome> {
  const evaluation = evaluateTrigger(
    parseConditions(row.conditions),
    payload,
    previousValues(row.last_values),
    row.match_mode === "all" ? "all" : "any",
  );

  const now = new Date();
  const patch: Record<string, unknown> = {
    last_values: evaluation.nextValues,
    last_event_at: now.toISOString(),
    last_detail: evaluation.summary.slice(0, 300),
    next_run_at: row.interval_minutes
      ? new Date(now.getTime() + row.interval_minutes * 60_000).toISOString()
      : null,
  };

  if (!evaluation.fired) {
    patch["last_status"] = "skipped";
    await db.from("scope_triggers").update(patch).eq("id", row.id);
    return { fired: false, evaluation, runs: 0, error: null };
  }

  let runs = 0;
  let error: string | null = null;
  try {
    const { runFlow } = await import("@/lib/flow-run.server");
    const values: Record<string, unknown> = {};
    for (const [path, value] of Object.entries(evaluation.nextValues)) {
      if (typeof value === "string" || typeof value === "number") {
        values[path.replace(/\./g, "_")] = value;
      }
    }
    const result = await runFlow({
      db: db as never,
      boardId: row.board_id,
      appId: null,
      startNodeId: row.node_id,
      userId: null,
      values,
      origin: "api",
      actorLabel,
    });
    runs = result.outputs.length;
  } catch (err) {
    error = err instanceof Error ? err.message : "Ablauf fehlgeschlagen";
  }

  patch["last_status"] = error ? "failed" : "fired";
  patch["last_run_at"] = now.toISOString();
  if (error) patch["last_detail"] = error.slice(0, 300);
  await db.from("scope_triggers").update(patch).eq("id", row.id);

  return { fired: true, evaluation, runs, error };
}
