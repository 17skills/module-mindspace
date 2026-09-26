import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

/**
 * Führt den verkabelten Ablauf einer App aus: Kamera-Quelle → API-Schritte → Ergebnis.
 * Welche Schritte laufen, bestimmt allein die Verkabelung im Scope. Gäste dürfen das
 * nur bei öffentlich freigegebenen Apps; das Foto selbst verlässt das Gerät nicht.
 */
export const runCameraFlow = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z
      .object({
        appId: z.string().uuid(),
        cameraId: z.string().uuid(),
        lat: z.number().min(-90).max(90),
        lon: z.number().min(-180).max(180),
        source: z.enum(["exif", "geraet", "manuell"]).default("manuell"),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { optionalRequestUserId, appRoleOf } = await import("@/lib/app-permissions.server");
    const { getRequest } = await import("@tanstack/react-start/server");
    const { assertRate, callerKey } = await import("@/lib/rate-limit.server");
    const userId = await optionalRequestUserId();
    const role = await appRoleOf(userId, data.appId);
    if (!role) throw new Error("Diese App ist nur für freigegebene Personen verfügbar.");
    const request = getRequest();
    const caller = userId ?? (request ? await callerKey(request) : "unknown");
    assertRate(`flow:${caller}`, userId ? 20 : 10, 60_000);

    const { loadPublicApp } = await import("@/lib/app-data.server");
    const { db, app, ids } = await loadPublicApp(data.appId);
    if (!ids.includes(data.cameraId)) throw new Error("Diese Quelle gehört nicht zur App.");
    const boardId = String(app.board_id);

    const [{ data: nodes }, { data: edges }] = await Promise.all([
      db.from("nodes").select("id,type,title,metadata").eq("board_id", boardId),
      db.from("edges").select("source_id,target_id").eq("board_id", boardId),
    ]);
    const byId = new Map((nodes ?? []).map((n) => [String(n.id), n]));
    const camera = byId.get(data.cameraId);
    if (!camera || camera.type !== "camera") throw new Error("Kamera-Quelle nicht gefunden.");
    const next = (id: string) =>
      (edges ?? []).filter((e) => String(e.source_id) === id).map((e) => String(e.target_id));

    const { cleanInput, readPointSpec, readPoints, pointsReport } = await import("@/lib/flow");
    const { callApi } = await import("@/lib/api-fetch.server");
    const { readApi } = await import("@/lib/api-module");
    const { retentionDays, expiresAt, sha256Hex } = await import("@/lib/runs");
    const input = cleanInput({ lat: data.lat, lon: data.lon, source: data.source });
    const origin = { lat: data.lat, lon: data.lon };

    type Step = {
      nodeId: string;
      title: string;
      status: "done" | "failed";
      error: string | null;
      points: ReturnType<typeof readPoints>;
    };
    const steps: Step[] = [];
    const outputs: { nodeId: string; text: string; runId: string | null }[] = [];

    for (const stepId of next(data.cameraId).slice(0, 5)) {
      const node = byId.get(stepId);
      if (!node || node.type !== "api") continue;
      const meta = (node.metadata ?? {}) as Record<string, unknown>;
      const cfg = readApi({ metadata: meta } as never);
      const title = String(node.title || "Schritt");
      let step: Step;
      let body = "";
      try {
        const answer = await callApi(cfg, input);
        body = answer.body;
        if (answer.status >= 400) throw new Error(`Dienst antwortet mit Status ${answer.status}`);
        const spec = readPointSpec(meta["points"]);
        step = { nodeId: stepId, title, status: "done", error: null, points: spec ? readPoints(body, spec, origin) : [] };
      } catch (err) {
        console.error("flow step", stepId, err);
        step = { nodeId: stepId, title, status: "failed", error: err instanceof Error ? err.message : "Fehler", points: [] };
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
            app_id: data.appId,
            user_id: userId,
            status: step.status,
            input_mime: "application/geo+json",
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
            finished_at: new Date().toISOString(),
            expires_at: expiresAt(retentionDays(outMeta)),
          })
          .select("id")
          .single();
        if (run) {
          await db.from("run_events").insert([
            { run_id: run.id, board_id: boardId, actor_id: userId, action: "created", detail: userId ? "App" : "App (Gast)" },
            { run_id: run.id, board_id: boardId, actor_id: userId, action: step.status, detail: title },
          ]);
        }
        outputs.push({ nodeId: outId, text, runId: run?.id ?? null });
      }
    }

    return { input: { lat: data.lat, lon: data.lon, source: data.source }, steps, outputs };
  });
