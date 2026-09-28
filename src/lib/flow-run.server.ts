/**
 * Ausführung eines verkabelten Ablaufs (Quelle → API-Schritte → Ergebnis) auf dem Server.
 * Wird sowohl von der App im Browser als auch vom Headless-Endpunkt benutzt, damit
 * beide Wege genau denselben Ablauf, dieselben Grenzen und denselben Nachweis haben.
 */
import { cleanInput, readPointSpec, readPoints, pointsReport } from "@/lib/flow";
import { callApi } from "@/lib/api-fetch.server";
import { readApi } from "@/lib/api-module";
import { retentionDays, expiresAt, sha256Hex } from "@/lib/runs";
import { datasetRefOf } from "@/lib/datasets";
import { RUN_MAX_SECONDS, TimeoutError, readBudget, withTimeout } from "@/lib/budget";

type Db = {
  from: (table: string) => any;
};

export type FlowStep = {
  nodeId: string;
  title: string;
  status: "done" | "failed" | "timeout";
  error: string | null;
  points: ReturnType<typeof readPoints>;
};

export type FlowResult = {
  input: Record<string, string | number>;
  steps: FlowStep[];
  outputs: { nodeId: string; text: string; runId: string | null }[];
};

export type RunFlowArgs = {
  db: Db;
  boardId: string;
  appId: string | null;
  startNodeId: string;
  userId: string | null;
  values: Record<string, unknown>;
  origin: "app" | "api";
  apiKeyId?: string | null;
  actorLabel: string;
};

/** Standarddeckel, wenn die Quelle kein eigenes Budget deklariert. */
const DEFAULT_MAX_STEPS = 5;

export async function runFlow(args: RunFlowArgs): Promise<FlowResult> {
  const { db, boardId, appId, startNodeId, userId, origin } = args;

  const [{ data: nodes }, { data: edges }] = await Promise.all([
    db.from("nodes").select("id,type,title,metadata").eq("board_id", boardId),
    db.from("edges").select("source_id,target_id").eq("board_id", boardId),
  ]);
  const byId = new Map<string, any>((nodes ?? []).map((n: any) => [String(n.id), n]));
  const start = byId.get(startNodeId);
  if (!start) throw new Error("Startmodul nicht gefunden.");

  const next = (id: string) =>
    (edges ?? []).filter((e: any) => String(e.source_id) === id).map((e: any) => String(e.target_id));

  const datasetRefsInto = (id: string) =>
    (edges ?? [])
      .filter((e: any) => String(e.target_id) === id)
      .map((e: any) => datasetRefOf(byId.get(String(e.source_id))?.metadata))
      .filter((ref: unknown) => ref !== null);

  const input = cleanInput(args.values);
  const lat = typeof input["lat"] === "number" ? (input["lat"] as number) : 0;
  const lon = typeof input["lon"] === "number" ? (input["lon"] as number) : 0;
  const point = { lat, lon };

  const startBudget = readBudget((start.metadata ?? {}) as Record<string, unknown>);
  const maxSteps = Math.min(startBudget.maxSteps || DEFAULT_MAX_STEPS, 10);

  const steps: FlowStep[] = [];
  const outputs: FlowResult["outputs"] = [];

  const runDeadline = Date.now() + RUN_MAX_SECONDS * 1000;
  let halted = false;

  for (const stepId of next(startNodeId).slice(0, maxSteps)) {
    if (halted) break;
    const node = byId.get(stepId);
    if (!node || node.type !== "api") continue;
    const meta = (node.metadata ?? {}) as Record<string, unknown>;
    const cfg = readApi({ metadata: meta } as never);
    const title = String(node.title || "Schritt");
    const stepMs = Math.min(readBudget(meta).timeoutSeconds * 1000, runDeadline - Date.now());
    let step: FlowStep;
    let body = "";
    const started = Date.now();
    try {
      if (stepMs <= 0) throw new TimeoutError(RUN_MAX_SECONDS);
      const answer = await withTimeout((signal) => callApi(cfg, input, signal), stepMs);
      body = answer.body;
      if (answer.status >= 400) throw new Error(`Dienst antwortet mit Status ${answer.status}`);
      const spec = readPointSpec(meta["points"]);
      step = {
        nodeId: stepId,
        title,
        status: "done",
        error: null,
        points: spec ? readPoints(body, spec, point) : [],
      };
    } catch (err) {
      console.error("flow step", stepId, err);
      const timedOut = err instanceof TimeoutError;
      if (timedOut) halted = true; // folgende Schritte laufen nicht stillschweigend weiter
      step = {
        nodeId: stepId,
        title,
        status: timedOut ? "timeout" : "failed",
        error: timedOut
          ? `${err.message} nach ${Math.round((Date.now() - started) / 1000)} s`
          : err instanceof Error
            ? err.message
            : "Fehler",
        points: [],
      };
    }
    steps.push(step);

    for (const outId of next(stepId)) {
      const out = byId.get(outId);
      if (!out || out.type !== "output") continue;
      const text = step.status === "done" ? pointsReport(title, step.points) : `${title}: ${step.error}`;
      const result = {
        kind: "text",
        title,
        text,
        url: null,
        hasFile: false,
        mime: "text/markdown",
        sourceId: stepId,
        capturedAt: new Date().toISOString(),
      };
      const outMeta = (out.metadata ?? {}) as Record<string, unknown>;
      const { data: run } = await db
        .from("runs")
        .insert({
          board_id: boardId,
          output_node_id: outId,
          app_id: appId,
          user_id: userId,
          status: step.status,
          input_mime: "application/json",
          input_sha256: await sha256Hex(JSON.stringify(input)),
          engine: "api",
          provider: (() => {
            try {
              return new URL(cfg.url).host;
            } catch {
              return "";
            }
          })(),
          model: "",
          context_checksum: await sha256Hex(body),
          result: result as never,
          result_sha256: await sha256Hex(JSON.stringify(result)),
          error: step.error,
          input_refs: datasetRefsInto(stepId) as never,
          origin,
          api_key_id: args.apiKeyId ?? null,
          finished_at: new Date().toISOString(),
          expires_at: expiresAt(retentionDays(outMeta)),
        })
        .select("id")
        .single();
      if (run) {
        await db.from("run_events").insert([
          { run_id: run.id, board_id: boardId, actor_id: userId, action: "created", detail: args.actorLabel },
          { run_id: run.id, board_id: boardId, actor_id: userId, action: step.status, detail: title },
        ]);
      }
      outputs.push({ nodeId: outId, text, runId: run?.id ?? null });
    }
  }

  return { input, steps, outputs };
}
