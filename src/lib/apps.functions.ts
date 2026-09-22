import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

type Json = Record<string, unknown>;

async function loadApp(appId: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: app, error } = await supabaseAdmin
    .from("apps")
    .select("id,board_id,title,kind,node_ids,branding,is_public,updated_at")
    .eq("id", appId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!app) throw new Error("Diese App gibt es nicht");
  if (!app.is_public) throw new Error("Diese App ist nicht freigegeben");
  const ids = Array.isArray(app.node_ids) ? (app.node_ids as unknown[]).map(String) : [];
  return { supabaseAdmin, app, ids };
}

/** Öffentliche Bühne: App-Einstellungen plus die zugehörigen Module. */
export const getPublicApp = createServerFn({ method: "POST" })
  .validator((input: unknown) => z.object({ appId: z.string().uuid() }).parse(input))
  .handler(async ({ data }) => {
    const { supabaseAdmin, app, ids } = await loadApp(data.appId);

    const [nodeRes, boardRes] = await Promise.all([
      supabaseAdmin.from("nodes").select("*").in("id", ids.length ? ids : [app.id]),
      supabaseAdmin.from("boards").select("id,title").eq("id", app.board_id).maybeSingle(),
    ]);
    if (nodeRes.error) throw new Error(nodeRes.error.message);

    const order = new Map(ids.map((id, index) => [id, index]));
    const nodes = (nodeRes.data ?? [])
      .filter((row) => order.has(String(row.id)))
      .sort((a, b) => (order.get(String(a.id)) ?? 0) - (order.get(String(b.id)) ?? 0));

    return {
      app: {
        id: app.id as string,
        boardId: app.board_id as string,
        title: app.title as string,
        kind: app.kind as string,
        branding: (app.branding ?? {}) as Json,
      },
      boardTitle: (boardRes.data?.title as string | undefined) ?? "",
      nodes: nodes as unknown as Json[],
    };
  });

/** Bewertet ein vor Ort aufgenommenes Foto für eine freigegebene App. */
export const appAssessPhoto = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z
      .object({
        appId: z.string().uuid(),
        image: z.string().min(32),
        label: z.string().default(""),
        report: z.string().default(""),
        rates: z.string().default(""),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    await loadApp(data.appId);
    const { assessPhoto } = await import("@/lib/inspection-vision.server");
    return assessPhoto({
      image: data.image,
      label: data.label,
      report: data.report,
      rates: data.rates,
    });
  });

const FindingInput = z.object({
  label: z.string().default(""),
  lat: z.number().nullable().default(null),
  lon: z.number().nullable().default(null),
  category: z.string().default("Sonstiges"),
  finding: z.string().default(""),
  priority: z.number().default(5),
  action: z.string().default(""),
  cost: z.number().default(0),
  confidence: z.number().default(0),
  reason: z.string().default(""),
  thumb: z.string().nullable().default(null),
  source: z.enum(["exif", "manuell", "unbekannt"]).default("unbekannt"),
});

async function inspectionNode(appId: string, nodeId?: string) {
  const { supabaseAdmin, ids } = await loadApp(appId);
  const { data: rows, error } = await supabaseAdmin
    .from("nodes")
    .select("id,type,metadata,content")
    .in("id", ids.length ? ids : [appId]);
  if (error) throw new Error(error.message);
  const target = (rows ?? []).find((row) =>
    nodeId ? String(row.id) === nodeId : row.type === "inspect",
  );
  if (!target) throw new Error("Diese App hat kein Inspektionsmodul");
  const meta = (target.metadata ?? {}) as Json;
  const findings = Array.isArray(meta["findings"]) ? [...(meta["findings"] as Json[])] : [];
  return { supabaseAdmin, target, meta, findings };
}

/** Neuen Befund aus der mobilen Erfassung in das Inspektionsmodul schreiben. */
export const appAddFinding = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z.object({ appId: z.string().uuid(), finding: FindingInput }).parse(input),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin, target, meta, findings } = await inspectionNode(data.appId);
    const entry = {
      ...data.finding,
      id: `finding-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      priority: Math.min(10, Math.max(1, Math.round(data.finding.priority))),
      createdAt: new Date().toISOString(),
      prevPriority: null,
      status: "offen",
      owner: "",
      due: "",
    };
    const next = [...findings, entry];
    const { error } = await supabaseAdmin
      .from("nodes")
      .update({ metadata: { ...meta, findings: next } })
      .eq("id", target.id);
    if (error) throw new Error(error.message);
    return { id: entry.id, count: next.length };
  });

/** Status einer Maßnahme aus dem Cockpit heraus ändern. */
export const appSetFindingStatus = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z
      .object({
        appId: z.string().uuid(),
        nodeId: z.string().uuid(),
        findingId: z.string().min(1),
        status: z.enum(["offen", "beauftragt", "in arbeit", "erledigt"]),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin, target, meta, findings } = await inspectionNode(
      data.appId,
      data.nodeId,
    );
    const next = findings.map((row) =>
      String(row["id"]) === data.findingId ? { ...row, status: data.status } : row,
    );
    const { error } = await supabaseAdmin
      .from("nodes")
      .update({ metadata: { ...meta, findings: next } })
      .eq("id", target.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
