/** Serverseitige Datenhelfer für App-Bühnen und App-MCP – nie vom Client importieren. */

export type AppRow = {
  id: string;
  board_id: string;
  title: string;
  kind: string;
  node_ids: unknown;
  branding: unknown;
  is_public: boolean;
  updated_at: string;
};

type Db = Awaited<ReturnType<typeof admin>>;
export type NodeRow = {
  id: string;
  board_id: string;
  type: string;
  title: string | null;
  content: string | null;
  metadata: Record<string, unknown> | null;
};

export async function admin(): Promise<typeof import("@/integrations/supabase/client.server")["supabaseAdmin"]> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

/** Lädt eine App und prüft, dass sie per Link freigegeben ist. */
export async function loadPublicApp(appId: string) {
  const db = await admin();
  const { data: app, error } = await db
    .from("apps")
    .select("id,board_id,title,kind,node_ids,branding,is_public,updated_at")
    .eq("id", appId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!app) throw new Error("Diese App gibt es nicht");
  if (!app.is_public) throw new Error("Diese App ist nicht freigegeben");
  const ids = Array.isArray(app.node_ids) ? (app.node_ids as unknown[]).map(String) : [];
  return { db, app: app as AppRow, ids };
}

/** App-Module in App-Reihenfolge plus Board-Titel. */
export async function loadAppNodes(appId: string) {
  const { db, app, ids } = await loadPublicApp(appId);
  const [nodeRes, boardRes] = await Promise.all([
    db.from("nodes").select("*").in("id", ids.length ? ids : [app.id]),
    db.from("boards").select("id,title").eq("id", app.board_id).maybeSingle(),
  ]);
  if (nodeRes.error) throw new Error(nodeRes.error.message);
  const order = new Map(ids.map((id, index) => [id, index]));
  const nodes = ((nodeRes.data ?? []) as NodeRow[])
    .filter((row) => order.has(String(row.id)))
    .sort((a, b) => (order.get(String(a.id)) ?? 0) - (order.get(String(b.id)) ?? 0));
  return {
    db,
    app,
    nodes,
    boardTitle: (boardRes.data?.title as string | undefined) ?? "",
  };
}

/** Findet das Inspektionsmodul der App und legt die Befundliste offen. */
export async function appFindingStore(appId: string, nodeId?: string) {
  const { db, ids } = await loadPublicApp(appId);
  const { data: rows, error } = await db
    .from("nodes")
    .select("id,type,metadata,content")
    .in("id", ids.length ? ids : [appId]);
  if (error) throw new Error(error.message);
  const target = (rows ?? []).find(
    (row) => (nodeId ? String(row.id) === nodeId : row.type === "inspect"),
  );
  if (!target) throw new Error("Diese App hat kein Inspektionsmodul");
  const meta = (target.metadata ?? {}) as Record<string, unknown>;
  const findings = Array.isArray(meta["findings"]) ? [...(meta["findings"] as Record<string, unknown>[])] : [];
  return { db, target, meta, findings };
}

export type FindingWrite = {
  label: string;
  lat: number | null;
  lon: number | null;
  category: string;
  finding: string;
  priority: number;
  action: string;
  cost: number;
  confidence: number;
  reason: string;
  thumb: string | null;
  source: string;
};

/** Hängt einen Befund an das Inspektionsmodul der App an. */
export async function insertFinding(appId: string, write: FindingWrite) {
  const { db, target, meta, findings } = await appFindingStore(appId);
  const entry = {
    ...write,
    id: `finding-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    priority: Math.min(10, Math.max(1, Math.round(write.priority))),
    createdAt: new Date().toISOString(),
    prevPriority: null,
    status: "offen",
    owner: "",
    due: "",
  };
  const next = [...findings, entry];
  const { error } = await db
    .from("nodes")
    .update({ metadata: { ...meta, findings: next } as never })
    .eq("id", target.id);
  if (error) throw new Error(error.message);
  return { id: String(entry.id), count: next.length };
}

const STATUSES = ["offen", "beauftragt", "in arbeit", "erledigt"] as const;

/** Setzt Status und optional Zuständigkeit/Termin eines Befunds. */
export async function changeFinding(
  appId: string,
  findingId: string,
  patch: { status?: string | undefined; owner?: string | undefined; due?: string | undefined },
  nodeId?: string,
) {
  const { db, target, meta, findings } = await appFindingStore(appId, nodeId);
  let hit = false;
  const next = findings.map((row) => {
    if (String(row["id"]) !== findingId) return row;
    hit = true;
    return {
      ...row,
      ...(patch.status && (STATUSES as readonly string[]).includes(patch.status)
        ? { status: patch.status }
        : {}),
      ...(patch.owner !== undefined ? { owner: patch.owner } : {}),
      ...(patch.due !== undefined ? { due: patch.due } : {}),
    };
  });
  if (!hit) throw new Error("Befund nicht gefunden");
  const { error } = await db
    .from("nodes")
    .update({ metadata: { ...meta, findings: next } as never })
    .eq("id", target.id);
  if (error) throw new Error(error.message);
  return { ok: true };
}
