import type { NodeRecord } from "@/components/canvas/board-context";

export type LibraryNode = {
  localId: string;
  parentLocalId: string | null;
  type: string;
  title: string;
  x: number;
  y: number;
  w: number;
  h: number;
  color: string | null;
  content: string;
  sourceUrl: string | null;
  metadata: Record<string, unknown>;
};

export type LibraryEdge = { source: string; target: string; label: string | null };

export type LibraryPayload = {
  version: 1;
  nodes: LibraryNode[];
  edges: LibraryEdge[];
  bounds: { width: number; height: number };
};

export type LibraryEntry = {
  id: string;
  title: string;
  description: string;
  tags: string[];
  scope: "single" | "group";
  payload: LibraryPayload;
  shareToken: string;
  isPublic: boolean;
  createdAt: string;
  updatedAt: string;
  /** Set for entries shared with me. */
  ownerEmail?: string;
};

export const EMPTY_PAYLOAD: LibraryPayload = {
  version: 1,
  nodes: [],
  edges: [],
  bounds: { width: 1, height: 1 },
};

/** Result values that must not travel into a fresh copy of a module. */
const RESULT_KEYS = [
  "agentResult",
  "agentReason",
  "agentAt",
  "agentFingerprint",
  "answers",
  "at",
  "lastStatus",
  "lastAt",
  "series",
  "marks",
  "thumbnail",
  "subtitle",
  "rowsData",
];

export function readPayload(value: unknown): LibraryPayload {
  const raw = value as Partial<LibraryPayload> | null;
  if (!raw || !Array.isArray(raw.nodes)) return EMPTY_PAYLOAD;
  return {
    version: 1,
    nodes: raw.nodes as LibraryNode[],
    edges: Array.isArray(raw.edges) ? (raw.edges as LibraryEdge[]) : [],
    bounds: raw.bounds ?? boundsOf(raw.nodes as LibraryNode[]),
  };
}

export function boundsOf(nodes: LibraryNode[]) {
  if (!nodes.length) return { width: 1, height: 1 };
  return {
    width: Math.max(...nodes.map((n) => n.x + n.w), 1),
    height: Math.max(...nodes.map((n) => n.y + n.h), 1),
  };
}

/** Turn selected modules (plus their children and inner connections) into a payload. */
export function capture(
  ids: string[],
  records: NodeRecord[],
  edges: { source: string; target: string; label?: string | null }[],
): LibraryPayload {
  const byId = new Map(records.map((r) => [r.id, r]));
  const picked = new Set<string>(ids.filter((id) => byId.has(id)));
  // children travel with their parent
  for (;;) {
    const before = picked.size;
    for (const record of records) {
      if (record.parent_id && picked.has(record.parent_id)) picked.add(record.id);
    }
    if (picked.size === before) break;
  }
  const list = records.filter((r) => picked.has(r.id));
  const roots = list.filter((r) => !r.parent_id || !picked.has(r.parent_id));
  const minX = roots.length ? Math.min(...roots.map((r) => r.position_x)) : 0;
  const minY = roots.length ? Math.min(...roots.map((r) => r.position_y)) : 0;

  const nodes: LibraryNode[] = list.map((record) => {
    const nested = Boolean(record.parent_id && picked.has(record.parent_id));
    return {
      localId: record.id,
      parentLocalId: nested ? record.parent_id : null,
      type: record.type,
      title: record.title ?? "",
      x: Math.round(nested ? record.position_x : record.position_x - minX),
      y: Math.round(nested ? record.position_y : record.position_y - minY),
      w: Math.round(record.width ?? 320),
      h: Math.round(record.height ?? 220),
      color: record.color,
      content: record.content ?? "",
      sourceUrl: record.source_url,
      metadata: { ...(record.metadata ?? {}) },
    };
  });

  const inner: LibraryEdge[] = edges
    .filter((edge) => picked.has(edge.source) && picked.has(edge.target))
    .map((edge) => ({ source: edge.source, target: edge.target, label: edge.label ?? null }));

  return { version: 1, nodes, edges: inner, bounds: boundsOf(nodes) };
}

/** Structure and settings only: contents and results are removed. */
export function stripContent(payload: LibraryPayload): LibraryPayload {
  return {
    ...payload,
    nodes: payload.nodes.map((node) => {
      const metadata = { ...node.metadata };
      for (const key of RESULT_KEYS) delete metadata[key];
      return { ...node, content: "", sourceUrl: null, metadata };
    }),
  };
}

export function summarize(payload: LibraryPayload) {
  const counts = new Map<string, number>();
  for (const node of payload.nodes) counts.set(node.type, (counts.get(node.type) ?? 0) + 1);
  return counts;
}

export function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.valueOf())
    ? ""
    : date.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export function rowToEntry(row: Record<string, unknown>): LibraryEntry {
  return {
    id: row["id"] as string,
    title: (row["title"] as string) ?? "Modul",
    description: (row["description"] as string | null) ?? "",
    tags: (row["tags"] as string[] | null) ?? [],
    scope: (row["scope"] as "single" | "group") ?? "single",
    payload: readPayload(row["payload"]),
    shareToken: (row["share_token"] as string) ?? "",
    isPublic: Boolean(row["is_public"]),
    createdAt: (row["created_at"] as string) ?? "",
    updatedAt: (row["updated_at"] as string) ?? "",
  };
}
