/** Serverseitige Datenhelfer für App-Bühnen und App-MCP – nie vom Client importieren. */

/** Vergleich in konstanter Zeit, damit Schlüssel nicht über Antwortzeiten erraten werden. */
function sameSecret(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export type AppRow = {
  id: string;
  board_id: string;
  user_id: string;
  title: string;
  description: string;
  kind: string;
  node_ids: unknown;
  branding: unknown;
  is_public: boolean;
  mcp_token: string;
  mcp_scope: string;
  updated_at: string;
  access_mode: string;
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

/**
 * Signiert Dateien von Ergebnis-Modulen für die App (1 h).
 * Der Pfad kommt nie aus dem Modul selbst, sondern von der Quellkarte desselben Scopes –
 * so kann ein Modul keine fremden Dateien freischalten.
 */
async function signOutputFiles(db: Awaited<ReturnType<typeof admin>>, boardId: string, nodes: NodeRow[]) {
  const outputs = nodes.filter((node) => node.type === "output");
  const sourceIds = outputs
    .map((node) => (node.metadata?.["output"] as { sourceId?: unknown; hasFile?: unknown } | undefined))
    .filter((o) => o?.hasFile === true && typeof o.sourceId === "string")
    .map((o) => String(o!.sourceId));
  if (!sourceIds.length) return;
  const { data } = await db
    .from("nodes")
    .select("id,storage_path")
    .eq("board_id", boardId)
    .in("id", sourceIds);
  const paths = new Map(
    (data ?? []).filter((row) => row.storage_path).map((row) => [String(row.id), String(row.storage_path)]),
  );
  await Promise.all(
    outputs.map(async (node) => {
      const sourceId = (node.metadata?.["output"] as { sourceId?: string } | undefined)?.sourceId;
      const path = sourceId ? paths.get(sourceId) : undefined;
      if (!path) return;
      const { data: signed } = await db.storage.from("uploads").createSignedUrl(path, 3600);
      if (signed?.signedUrl) node.metadata = { ...(node.metadata ?? {}), output_file_url: signed.signedUrl };
    }),
  );
}

export async function admin(): Promise<typeof import("@/integrations/supabase/client.server")["supabaseAdmin"]> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

/** Lädt eine App und prüft, dass sie per Link freigegeben ist. */
export async function loadPublicApp(appId: string) {
  const db = await admin();
  const { data: app, error } = await db
    .from("apps")
    .select(
      "id,board_id,user_id,title,description,kind,node_ids,branding,is_public,mcp_token,mcp_scope,updated_at,access_mode,access_revoked_at,access_expires_at",
    )
    .eq("id", appId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!app) throw new Error("Diese App gibt es nicht");
  if (!app.is_public) throw new Error("Diese App ist nicht freigegeben");
  if (app.access_revoked_at) throw new Error("Diese App ist nicht freigegeben");
  if (app.access_expires_at && new Date(app.access_expires_at).getTime() <= Date.now()) {
    throw new Error("Diese App ist nicht mehr freigegeben");
  }
  const ids = Array.isArray(app.node_ids) ? (app.node_ids as unknown[]).map(String) : [];
  return { db, app: app as AppRow, ids };
}

export type McpScope = "read" | "write";

/**
 * Prüft den Schlüssel eines KI-Assistenten: entweder als `Authorization: Bearer …`
 * oder als `?token=` an der Verbindungsadresse. Ohne gültigen Schlüssel: kein Zugriff.
 */
export async function authorizeAppMcp(
  appId: string,
  request: Request,
): Promise<{ ok: true; scope: McpScope } | { ok: false; status: number }> {
  const { rateLimit, callerKey } = await import("@/lib/rate-limit.server");
  const caller = await callerKey(request);
  // Begrenzt Rateversuche und Massenabfragen je Aufrufer und App.
  if (!rateLimit(`app-mcp:${appId}:${caller}`, 120, 60_000).ok) {
    return { ok: false, status: 429 };
  }

  let app: AppRow;
  try {
    app = (await loadPublicApp(appId)).app;
  } catch {
    return { ok: false, status: 404 };
  }
  const header = request.headers.get("authorization") ?? "";
  const bearer = /^bearer\s+(.+)$/i.exec(header.trim())?.[1]?.trim() ?? "";
  const query = new URL(request.url).searchParams.get("token")?.trim() ?? "";
  const presented = bearer || query;
  if (!presented || !sameSecret(presented, String(app.mcp_token))) {
    if (!rateLimit(`app-mcp-fail:${appId}:${caller}`, 10, 60_000).ok) {
      return { ok: false, status: 429 };
    }
    return { ok: false, status: 401 };
  }
  return { ok: true, scope: app.mcp_scope === "write" ? "write" : "read" };
}


/** App-Module in App-Reihenfolge plus Board-Titel. */
export async function loadAppNodes(appId: string) {
  const { db, app, ids } = await loadPublicApp(appId);
  const [nodeRes, boardRes] = await Promise.all([
    db.from("nodes").select("*").in("id", ids.length ? ids : [app.id]),
    db.from("boards").select("id,title,rules").eq("id", app.board_id).maybeSingle(),
  ]);
  if (nodeRes.error) throw new Error(nodeRes.error.message);
  const order = new Map(ids.map((id, index) => [id, index]));
  const nodes = ((nodeRes.data ?? []) as NodeRow[])
    .filter((row) => order.has(String(row.id)))
    .sort((a, b) => (order.get(String(a.id)) ?? 0) - (order.get(String(b.id)) ?? 0));
  await attachFindings(db, nodes);
  await signOutputFiles(db, String(app.board_id), nodes);
  return {
    db,
    app,
    nodes,
    boardTitle: (boardRes.data?.title as string | undefined) ?? "",
    boardRules: boardRes.data?.rules ?? {},
  };
}


/** Setzt die Befunde aus `inspection_findings` in die Inspektionsmodule ein. */
export async function attachFindings(db: Db, nodes: NodeRow[]) {
  const ids = nodes.filter((row) => row.type === "inspect").map((row) => String(row.id));
  if (!ids.length) return;
  const { data } = await db
    .from("inspection_findings")
    .select("node_id,data")
    .in("node_id", ids)
    .order("created_at", { ascending: true });
  const byNode = new Map<string, unknown[]>();
  for (const row of data ?? []) {
    const list = byNode.get(String(row.node_id)) ?? [];
    list.push(row.data);
    byNode.set(String(row.node_id), list);
  }
  for (const row of nodes) {
    const list = byNode.get(String(row.id));
    if (!list) continue;
    row.metadata = { ...((row.metadata ?? {}) as Record<string, unknown>), findings: list } as never;
  }
}

/** Findet das Inspektionsmodul der App und legt die Befundliste offen. */
export async function appFindingStore(appId: string, nodeId?: string) {
  const { db, app, ids } = await loadPublicApp(appId);
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
  const { data: stored } = await db
    .from("inspection_findings")
    .select("data")
    .eq("node_id", String(target.id))
    .order("created_at", { ascending: true });
  const legacy = Array.isArray(meta["findings"]) ? (meta["findings"] as Record<string, unknown>[]) : [];
  const findings = stored && stored.length ? stored.map((row) => row.data as Record<string, unknown>) : [...legacy];
  return { db, app, target, meta, findings };
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
  /** Vollbild als Data-URL; wird in den Bildspeicher ausgelagert. */
  photo?: string | null;
  source: string;
};

/**
 * Legt das Vollbild im Bildspeicher ab, damit die Moduldaten klein bleiben.
 * Schlägt der Upload fehl, zählt nur das kleine Vorschaubild.
 */
async function storePhoto(
  db: Db,
  boardId: string,
  findingId: string,
  dataUrl: string | null | undefined,
): Promise<string | null> {
  const match = /^data:(image\/[a-z+]+);base64,(.+)$/i.exec(dataUrl ?? "");
  if (!match) return null;
  try {
    const binary = atob(match[2]!);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const path = `${boardId}/${findingId}.jpg`;
    const { error } = await db.storage
      .from("field-photos")
      .upload(path, bytes, { contentType: match[1]!, upsert: true });
    if (error) return null;
    return path;
  } catch {
    return null;
  }
}

/** Hängt einen Befund an das Inspektionsmodul der App an. */
export async function insertFinding(appId: string, write: FindingWrite) {
  const { db, app, target, findings } = await appFindingStore(appId);
  const id = `finding-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const { photo, ...rest } = write;
  const photoPath = await storePhoto(db, app.board_id, id, photo ?? write.thumb);
  const entry = {
    ...rest,
    id,
    photoPath,
    priority: Math.min(10, Math.max(1, Math.round(write.priority))),
    createdAt: new Date().toISOString(),
    prevPriority: null,
    status: "offen",
    owner: "",
    due: "",
  };
  // Eigene Zeile je Befund: parallele Erfasser blockieren und überschreiben sich nicht.
  const { error } = await db.from("inspection_findings").insert({
    id,
    board_id: String(app.board_id),
    node_id: String(target.id),
    data: entry as never,
    created_at: entry.createdAt,
  });
  if (error) throw new Error(error.message);
  return { id, count: findings.length + 1 };
}

const STATUSES = ["offen", "beauftragt", "in arbeit", "erledigt"] as const;

/** Setzt Status und optional Zuständigkeit/Termin eines Befunds. */
export async function changeFinding(
  appId: string,
  findingId: string,
  patch: { status?: string | undefined; owner?: string | undefined; due?: string | undefined },
  nodeId?: string,
) {
  const { db, app, target, findings } = await appFindingStore(appId, nodeId);
  let hit = false;
  let changed: Record<string, unknown> | null = null;
  const next = findings.map((row) => {
    if (String(row["id"]) !== findingId) return row;
    hit = true;
    changed = {
      ...row,
      ...(patch.status && (STATUSES as readonly string[]).includes(patch.status)
        ? { status: patch.status }
        : {}),
      ...(patch.owner !== undefined ? { owner: patch.owner } : {}),
      ...(patch.due !== undefined ? { due: patch.due } : {}),
    };
    return changed;
  });
  if (!hit || !changed || !next.length) throw new Error("Befund nicht gefunden");
  const { error } = await db.from("inspection_findings").upsert({
    id: findingId,
    board_id: String(app.board_id),
    node_id: String(target.id),
    data: changed as never,
  });
  if (error) throw new Error(error.message);
  return { ok: true };
}
