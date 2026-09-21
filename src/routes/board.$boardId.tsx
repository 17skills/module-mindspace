import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Background,
  BackgroundVariant,
  SelectionMode,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Connection,
  type Edge,
  type Node,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { toast } from "sonner";
import { Shapes } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ArrowLeft,
  Check,
  CloudCheck,
  CloudOff,
  CloudUpload,
  FileUp,
  LayoutTemplate,
  Link2,
  Lock,
  LockOpen,
  MessageSquare,
  NotebookPen,
  PanelsTopLeft,
  Share2,
  StickyNote,
  Type,
  Upload,
  Workflow,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { trackSave, useSaveStatus, clearSaveError } from "@/lib/save-status";
import {
  BoardContext,
  type InspectorTab,
  type NodeRecord,
  type StructureItem,
} from "@/components/canvas/board-context";
import {
  ChatNode,
  ContentNode,
  DataNode,
  FrameNode,
  NoteNode,
  SHAPES,
  ShapeNode,
  shapeKind,
  TEXT_SIZES,
  TextNode,
  textSize,
  ZONE_COLORS,
  ZoneNode,
} from "@/components/canvas/nodes";
import { InspectorPanel } from "@/components/canvas/inspector/InspectorPanel";
import { extractFileText, isAudioFile, youtubeId } from "@/lib/extract";
import { filePreview } from "@/lib/preview";
import { itemToPatch } from "@/lib/structure";
import { isProfileLink, profileProvider } from "@/lib/profiles";
import { segmentsFromFile } from "@/lib/segments";
import { ZONE_ROLES, isAuto, readAssignment, zoneAt, zoneLabel } from "@/lib/zones";
import { TemplateDialog } from "@/components/canvas/TemplateDialog";
import { ShareDialog } from "@/components/canvas/ShareDialog";
import { ZONE_WHITE, templateBounds, type Template, type TemplateField } from "@/lib/templates";

import {
  extractStructured,
  fetchLinkMeta,
  fetchPageText,
  fetchYoutube,
  resolvePodcast,
  transcribeAudio,
} from "@/lib/ingest.functions";

export const Route = createFileRoute("/board/$boardId")({
  head: () => ({
    meta: [
      { title: "Board – Canvas Spark" },
      {
        name: "description",
        content:
          "Arbeitsfläche mit Videos, Podcasts, Dokumenten, Notizen und KI-Chat – alles miteinander verbunden.",
      },
      { property: "og:title", content: "Board – Canvas Spark" },
      {
        property: "og:description",
        content: "Inhalte verbinden, gruppieren und per Chat auswerten.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: () => (
    <ReactFlowProvider>
      <BoardPage />
    </ReactFlowProvider>
  ),
});

const nodeTypes = {
  content: ContentNode,
  note: NoteNode,
  chat: ChatNode,
  frame: FrameNode,
  data: DataNode,
  zone: ZoneNode,
  shape: ShapeNode,
  text: TextNode,
};

const DATA_TYPES = new Set(["table", "list", "chart"]);

const DEFAULT_SIZE: Record<string, { width: number; height: number }> = {
  note: { width: 260, height: 200 },
  chat: { width: 400, height: 460 },
  frame: { width: 640, height: 460 },
  zone: { width: 420, height: 360 },
  shape: { width: 200, height: 140 },
  text: { width: 260, height: 48 },
  table: { width: 400, height: 300 },
  list: { width: 300, height: 280 },
  chart: { width: 400, height: 320 },
  default: { width: 320, height: 340 },
};

/** Space a template group leaves around its fields. */
const GROUP_PAD = { x: 16, top: 52, bottom: 16 };
/** Templates are placed larger so each field can hold several cards. */
const TEMPLATE_SCALE = 2;

// Einheitliche Zustände für Werkzeugleisten-Symbole (Hover, Aktiv, Fokus, Deaktiviert)
function toolBtn(active = false) {
  return cn(
    "size-10 shrink-0 rounded-xl text-muted-foreground transition-colors duration-150",
    "hover:bg-accent hover:text-accent-foreground",
    "active:bg-accent/70",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-offset-1",
    "disabled:pointer-events-none disabled:opacity-40",
    active && "bg-accent text-accent-foreground",
  );
}

/** Fields of a template group, with positions relative to the group. */
function groupFields(container: NodeRecord, all: NodeRecord[]): NodeRecord[] {
  return all.filter((item) => item.type === "zone" && item.parent_id === container.id);
}

/** Background fields with absolute positions (children of a group included). */
function absoluteZones(all: NodeRecord[]): NodeRecord[] {
  const byId = new Map(all.map((item) => [item.id, item]));
  return all
    .filter((item) => item.type === "zone")
    .map((zone) => {
      const parent = zone.parent_id ? byId.get(zone.parent_id) : null;
      return parent
        ? {
            ...zone,
            position_x: zone.position_x + parent.position_x,
            position_y: zone.position_y + parent.position_y,
          }
        : zone;
    });
}


function toFlowNode(record: NodeRecord): Node {
  const size = DEFAULT_SIZE[record.type] ?? DEFAULT_SIZE["default"]!;
  const kind =
    record.type === "note" ||
    record.type === "chat" ||
    record.type === "frame" ||
    record.type === "zone" ||
    record.type === "shape" ||
    record.type === "text"
      ? record.type
      : DATA_TYPES.has(record.type)
        ? "data"
        : "content";
  const zoneLocked =
    kind === "zone" &&
    (record.metadata as Record<string, unknown> | null)?.["locked"] === true;
  return {
    id: record.id,
    type: kind,
    position: { x: record.position_x, y: record.position_y },
    width: record.width ?? size.width,
    height: record.height ?? size.height,
    data: { record },
    ...(record.parent_id ? { parentId: record.parent_id, extent: "parent" as const } : {}),
    ...(kind === "frame" ? { zIndex: -1 } : {}),
    ...(kind === "zone"
      ? { zIndex: -2, connectable: false, deletable: true, draggable: !zoneLocked }
      : {}),
    ...(kind === "text" ? { connectable: false } : {}),
  };
}

/** Template groups first, then their fields, then frames, then everything else. */
function layer(record: NodeRecord) {
  if (record.type === "zone") return record.parent_id ? -2 : -3;
  return record.type === "frame" ? -1 : 0;
}

function sortNodes(list: NodeRecord[]) {
  const byId = new Map(list.map((item) => [item.id, item]));
  const depth = (record: NodeRecord) => {
    let level = 0;
    let parent = record.parent_id ? byId.get(record.parent_id) : null;
    while (parent && level < 10) {
      level += 1;
      parent = parent.parent_id ? byId.get(parent.parent_id) : null;
    }
    return level;
  };
  // parents always before their children, then background fields before cards
  return [...list].sort((a, b) => depth(a) - depth(b) || layer(a) - layer(b));
}

type Menu = { x: number; y: number; flowX: number; flowY: number; nodeId?: string };

function BoardPage() {
  const { boardId } = Route.useParams();
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const { screenToFlowPosition, setCenter } = useReactFlow();

  const [title, setTitle] = useState("");
  const [records, setRecords] = useState<Record<string, NodeRecord>>({});
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [ready, setReady] = useState(false);
  const [menu, setMenu] = useState<Menu | null>(null);
  const [inspector, setInspector] = useState<{ nodeId: string; tab: InspectorTab } | null>(null);
  const [linkPrompt, setLinkPrompt] = useState<{ x: number; y: number } | null>(null);
  const [linkValue, setLinkValue] = useState("");
  const [templateOpen, setTemplateOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [isOwner, setIsOwner] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const filePosition = useRef<{ x: number; y: number } | null>(null);
  const templatePosition = useRef<{ x: number; y: number } | null>(null);
  const recordsRef = useRef(records);
  recordsRef.current = records;
  const edgesRef = useRef(edges);
  edgesRef.current = edges;

  useEffect(() => {
    if (!loading && !user) void navigate({ to: "/auth" });
  }, [loading, user, navigate]);

  const userId = user?.id ?? null;
  const loadedKey = useRef<string | null>(null);

  useEffect(() => {
    if (!userId) return;
    // a token refresh must never reload the board: that made modules flicker away
    const key = `${boardId}:${userId}`;
    if (loadedKey.current === key) return;
    loadedKey.current = key;
    let active = true;
    let done = false;
    void (async () => {
      const [boardRes, nodeRes, edgeRes] = await Promise.all([
        supabase.from("boards").select("title,user_id").eq("id", boardId).single(),
        supabase.from("nodes").select("*").eq("board_id", boardId),
        supabase.from("edges").select("*").eq("board_id", boardId),
      ]);
      if (!active) return;
      if (boardRes.error) {
        toast.error("Board nicht gefunden");
        void navigate({ to: "/" });
        return;
      }
      setTitle(boardRes.data.title);
      setIsOwner(boardRes.data.user_id === userId);
      const list = (nodeRes.data ?? []) as unknown as NodeRecord[];
      setRecords(Object.fromEntries(list.map((r) => [r.id, r])));
      setNodes(sortNodes(list).map(toFlowNode));
      // connections belong to the group, not to its members
      const parentOf = new Map(list.map((r) => [r.id, r.parent_id]));
      const seen = new Set<string>();
      const keep: Edge[] = [];
      const drop: string[] = [];
      for (const row of edgeRes.data ?? []) {
        const id = row.id as string;
        const source = parentOf.get(row.source_id as string) ?? (row.source_id as string);
        const target = parentOf.get(row.target_id as string) ?? (row.target_id as string);
        const key = [source, target].sort().join("::");
        if (source === target || seen.has(key)) {
          drop.push(id);
          continue;
        }
        seen.add(key);
        keep.push({ id, source, target, animated: true });
        if (source !== row.source_id || target !== row.target_id) {
          trackSave(supabase.from("edges").update({ source_id: source, target_id: target }).eq("id", id));
        }
      }
      if (drop.length) trackSave(supabase.from("edges").delete().in("id", drop));
      setEdges(keep);
      setReady(true);
      done = true;
    })();
    return () => {
      active = false;
      // allow a retry when the board never finished loading
      if (!done) loadedKey.current = null;
    };
  }, [boardId, userId, navigate, setNodes, setEdges]);

  // keep node data in sync with records
  useEffect(() => {
    setNodes((current) =>
      current.map((node) => {
        const record = records[node.id];
        if (!record) return node;
        const zoneLocked =
          record.type === "zone" &&
          (record.metadata as Record<string, unknown> | null)?.["locked"] === true;
        return { ...node, data: { record }, draggable: !zoneLocked };
      }),
    );
  }, [records, setNodes]);

  const patchRecord = useCallback((id: string, patch: Partial<NodeRecord>) => {
    setRecords((current) => {
      const existing = current[id];
      if (!existing) return current;
      return { ...current, [id]: { ...existing, ...patch } };
    });
  }, []);

  const updateNode = useCallback(
    (id: string, patch: Partial<NodeRecord>) => {
      patchRecord(id, patch);
      trackSave(
        supabase
          .from("nodes")
          .update(patch as never)
          .eq("id", id)
          .then(({ error }) => {
            if (error) {
              toast.error(error.message);
              throw error;
            }
          }),
      );
    },
    [patchRecord],
  );

  const deleteNode = useCallback(
    (id: string) => {
      // children keep living in the database (parent_id is set to null there),
      // so collect the whole subtree and remove it explicitly
      const ids = new Set<string>([id]);
      for (;;) {
        const before = ids.size;
        for (const record of Object.values(recordsRef.current)) {
          if (record.parent_id && ids.has(record.parent_id)) ids.add(record.id);
        }
        if (ids.size === before) break;
      }
      const list = [...ids];
      setNodes((current) => current.filter((n) => !ids.has(n.id)));
      setEdges((current) => current.filter((e) => !ids.has(e.source) && !ids.has(e.target)));
      setRecords((current) => {
        const next = { ...current };
        for (const key of list) delete next[key];
        return next;
      });
      trackSave(
        supabase
          .from("nodes")
          .delete()
          .in("id", list)
          .then(({ error }) => {
            if (error) {
              toast.error(error.message);
              throw error;
            }
          }),
      );
    },
    [setNodes, setEdges],
  );

  const createRecord = useCallback(
    async (input: Partial<NodeRecord> & { type: string }) => {
      if (!user) throw new Error("Nicht angemeldet");
      const size = DEFAULT_SIZE[input.type] ?? DEFAULT_SIZE["default"]!;
      const width = input.width ?? size.width;
      const height = input.height ?? size.height;
      const x = input.position_x ?? 0;
      const y = input.position_y ?? 0;
      // cards dropped onto a background field belong to that field
      const zone =
        input.type === "zone" || input.type === "frame" || input.parent_id
          ? null
          : zoneAt(
              { x: x + width / 2, y: y + height / 2 },
              absoluteZones(Object.values(recordsRef.current)),
            );
      const payload = {
        board_id: boardId,
        user_id: user.id,
        type: input.type,
        parent_id: input.parent_id ?? null,
        title: input.title ?? null,
        position_x: x,
        position_y: y,
        width,
        height,
        source_url: input.source_url ?? null,
        storage_path: input.storage_path ?? null,
        mime_type: input.mime_type ?? null,
        content: input.content ?? null,
        status: input.status ?? "ready",
        color: input.color ?? null,
        metadata: {
          ...(input.metadata ?? {}),
          ...(zone ? { zoneId: zone.id, zoneRole: ZONE_ROLES[0] } : {}),
        },
      };
      // a Supabase builder fires a new request on every await — resolve it once
      const insertPromise = Promise.resolve(
        supabase.from("nodes").insert(payload as never).select("*").single(),
      );
      trackSave(insertPromise);
      const { data, error } = await insertPromise;
      if (error) throw error;
      const record = data as unknown as NodeRecord;
      setRecords((current) => ({ ...current, [record.id]: record }));
      setNodes((current) =>
        (record.type === "frame" || record.type === "zone") && !record.parent_id
          ? [toFlowNode(record), ...current]
          : [...current, toFlowNode(record)],
      );
      return record;
    },
    [boardId, user, setNodes],
  );

  const createEdge = useCallback(
    (sourceId: string, targetId: string) => {
      if (!user || sourceId === targetId) return;
      const exists = edgesRef.current.some(
        (e) =>
          (e.source === sourceId && e.target === targetId) ||
          (e.source === targetId && e.target === sourceId),
      );
      if (exists) return;
      const id = crypto.randomUUID();
      setEdges((current) => [
        ...current,
        { id, source: sourceId, target: targetId, animated: true },
      ]);
      trackSave(
        supabase
          .from("edges")
          .insert({
            id,
            board_id: boardId,
            user_id: user.id,
            source_id: sourceId,
            target_id: targetId,
          } as never)
          .then(({ error }) => {
            if (error) {
              toast.error(error.message);
              throw error;
            }
          }),
      );
    },
    [boardId, setEdges, user],
  );

  const collectContext = useCallback((id: string) => {
    const connected = new Set<string>();
    for (const edge of edgesRef.current) {
      if (edge.source === id) connected.add(edge.target);
      if (edge.target === id) connected.add(edge.source);
    }
    // frames contribute their children
    for (const nodeId of [...connected]) {
      const record = recordsRef.current[nodeId];
      if (record?.type === "frame") {
        for (const candidate of Object.values(recordsRef.current)) {
          if (candidate.parent_id === nodeId) connected.add(candidate.id);
        }
      }
    }
    // a chat sitting in a background field sees everything assigned to that field
    const own = readAssignment(recordsRef.current[id]);
    if (own) {
      for (const candidate of Object.values(recordsRef.current)) {
        if (candidate.id !== id && readAssignment(candidate)?.zoneId === own.zoneId) {
          connected.add(candidate.id);
        }
      }
    }
    const parts: string[] = [];
    for (const nodeId of connected) {
      const record = recordsRef.current[nodeId];
      if (!record || record.type === "chat" || record.type === "frame" || record.type === "zone")
        continue;
      if (!record.content) continue;
      const field = zoneLabel(record, recordsRef.current);
      const prefix = field
        ? `[${field.title} · ${field.role}]${field.note ? ` — Begründung: ${field.note}` : ""} `
        : "";
      parts.push(
        `### ${prefix}${record.title ?? "Modul"} (${record.type}${record.source_url ? `, ${record.source_url}` : ""})\n${record.content.slice(0, 60_000)}`,
      );
    }
    return parts.join("\n\n---\n\n");
  }, []);

  /**
   * Transparent breakdown for the chat module: which connected modules
   * actually feed the chat, and which are deliberately left out (and why).
   * Mirrors collectContext exactly — profile links never carry content.
   */
  const contextReport = useCallback((id: string): ContextReport => {
    const connected = new Set<string>();
    for (const edge of edgesRef.current) {
      if (edge.source === id) connected.add(edge.target);
      if (edge.target === id) connected.add(edge.source);
    }
    for (const nodeId of [...connected]) {
      const record = recordsRef.current[nodeId];
      if (record?.type === "frame") {
        for (const candidate of Object.values(recordsRef.current)) {
          if (candidate.parent_id === nodeId) connected.add(candidate.id);
        }
      }
    }
    const own = readAssignment(recordsRef.current[id]);
    if (own) {
      for (const candidate of Object.values(recordsRef.current)) {
        if (candidate.id !== id && readAssignment(candidate)?.zoneId === own.zoneId) {
          connected.add(candidate.id);
        }
      }
    }
    const report: ContextReport = { used: [], excluded: [] };
    for (const nodeId of connected) {
      const record = recordsRef.current[nodeId];
      if (!record || record.type === "chat" || record.type === "frame" || record.type === "zone")
        continue;
      const title = record.title ?? "Modul";
      if (isProfileLink(record)) {
        report.excluded.push({ id: record.id, title, reason: "Profil-Link — kontextfrei" });
      } else if (!record.content) {
        report.excluded.push({
          id: record.id,
          title,
          reason: record.status === "processing" ? "Wird noch eingelesen" : "Kein Inhalt",
        });
      } else {
        report.used.push({
          id: record.id,
          title,
          type: record.type,
          chars: Math.min(record.content.length, 60_000),
        });
      }
    }
    return report;
  }, []);

  /** Assign a card to the background field it now sits on. */
  const syncZone = useCallback((id: string, x: number, y: number) => {
    const record = recordsRef.current[id];
    if (!record || record.type === "zone" || record.type === "frame" || record.parent_id) return;
    if (!isAuto(record)) return;
    const centre = {
      x: x + (record.width ?? 320) / 2,
      y: y + (record.height ?? 300) / 2,
    };
    const zone = zoneAt(centre, absoluteZones(Object.values(recordsRef.current)));
    const current = readAssignment(record);
    if ((zone?.id ?? null) === (current?.zoneId ?? null)) return;
    updateNode(id, {
      metadata: {
        ...(record.metadata ?? {}),
        zoneId: zone?.id ?? null,
        ...(zone && !current?.role ? { zoneRole: ZONE_ROLES[0] } : {}),
      },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [updateNode]);

  const addNoteFrom = useCallback(
    (sourceId: string, text: string) => {
      const source = recordsRef.current[sourceId];
      void createRecord({
        type: "note",
        title: "KI-Antwort",
        content: text,
        position_x: (source?.position_x ?? 0) + 440,
        position_y: source?.position_y ?? 0,
      }).catch((error) => toast.error(error.message));
    },
    [createRecord],
  );

  const extractStructure = useCallback(
    (sourceId: string) => {
      const source = recordsRef.current[sourceId];
      if (!source?.content) {
        toast.info("Dieses Modul enthält noch keinen Text");
        return;
      }
      const job = toast.loading("Strukturierte Daten werden gesucht …");
      void extractStructured({ data: { text: source.content, title: source.title ?? "" } })
        .then(async ({ items }) => {
          if (items.length === 0) {
            toast.info("Keine strukturierten Daten gefunden", { id: job });
            return;
          }
          let offset = 0;
          for (const item of items) {
            const type = item.kind;
            const content =
              type === "list"
                ? item.rows.map((row) => `- ${row[0] ?? ""}`).join("\n")
                : [item.columns.join(" | "), ...item.rows.map((row) => row.join(" | "))].join("\n");
            const created = await createRecord({
              type,
              title: item.title,
              content,
              position_x: (source.position_x ?? 0) + 420,
              position_y: (source.position_y ?? 0) + offset,
              metadata: {
                columns: item.columns,
                rows: item.rows,
                ...(type === "chart"
                  ? { chartType: item.chartType === "none" ? "bar" : item.chartType }
                  : {}),
              },
            });
            createEdge(source.parent_id ?? source.id, created.id);
            offset += 360;
          }
          toast.success(`${items.length} Modul(e) erstellt`, { id: job });
        })
        .catch((error: unknown) =>
          toast.error(error instanceof Error ? error.message : "Analyse fehlgeschlagen", {
            id: job,
          }),
        );
    },
    [createRecord, createEdge],
  );

  const addUrl = useCallback(
    async (rawUrl: string, at?: { x: number; y: number }) => {
      const url = rawUrl.trim();
      if (!url) return;
      let parsed: URL;
      try {
        parsed = new URL(url);
      } catch {
        toast.error("Das ist keine gültige Adresse");
        return;
      }

      const position = at ?? centerPosition();
      const isYoutube = Boolean(youtubeId(url));
      const isAudioUrl = /\.(mp3|m4a|wav|aac|ogg)(\?|$)/i.test(parsed.pathname);
      const isFeed =
        /\/(rss|feed)/i.test(parsed.pathname) || /podcast|spotify|apple/i.test(parsed.hostname);
      // Profile sozialer Netzwerke liefern ohne Anmeldung keinen verwertbaren
      // Text — nur als reines Link-Modul anzeigen, keinen Inhalt auslesen und
      // nichts als Chat-Kontext übermitteln.
      const profile = profileProvider(parsed.hostname);

      const record = await createRecord({
        type: isYoutube ? "youtube" : isAudioUrl || isFeed ? "podcast" : "link",
        title: url,
        source_url: url,
        status: profile ? "ready" : "processing",
        position_x: position.x,
        position_y: position.y,
      });

      if (profile) {
        const slug = parsed.pathname.split("/").filter(Boolean).pop() ?? profile;
        updateNode(record.id, { title: `${profile}: ${slug}` });
        try {
          const meta = await fetchLinkMeta({ data: { url } });
          const name =
            meta.title
              ?.replace(/\s*[|\-–—]\s*(LinkedIn|Xing|X|Twitter|Instagram|Facebook|Threads|TikTok|Mastodon).*$/i, "")
              .trim() || slug;
          updateNode(record.id, {
            title: name,
            metadata: {
              ...(recordsRef.current[record.id]?.metadata ?? {}),
              provider: profile,
              ...(meta.description ? { subtitle: meta.description } : {}),
              ...(meta.image ? { thumbnail: meta.image } : {}),
            },
          });
        } catch {
          /* Vorschau ist optional */
        }
        return;
      }

      try {
        if (isYoutube) {
          const info = await fetchYoutube({ data: { url } });
          updateNode(record.id, {
            title: info.title,
            content: info.transcript,
            status: info.transcript ? "ready" : "error",
            error: info.transcript ? null : info.transcriptError,
            metadata: {
              ...(recordsRef.current[record.id]?.metadata ?? {}),
              thumbnail: info.thumbnail,
              author: info.author,
              ...(info.segments?.length ? { segments: info.segments } : {}),
            },
          });
          return;
        }

        if (isAudioUrl || isFeed) {
          const episode = isAudioUrl
            ? { title: url.split("/").pop() ?? "Audio", audioUrl: url, image: null }
            : await resolvePodcast({ data: { url } });
          updateNode(record.id, {
            title: episode.title,
            source_url: episode.audioUrl,
            ...(episode.image
              ? {
                  metadata: {
                    ...(recordsRef.current[record.id]?.metadata ?? {}),
                    thumbnail: episode.image,
                  },
                }
              : {}),
          });
          const { text, segments } = await transcribeAudio({ data: { audioUrl: episode.audioUrl } });
          updateNode(record.id, {
            content: text,
            status: text ? "ready" : "error",
            error: text ? null : "Transkript ist leer",
            ...(segments?.length
              ? { metadata: { ...(recordsRef.current[record.id]?.metadata ?? {}), segments } }
              : {}),
          });
          return;
        }

        const page = await fetchPageText({ data: { url } });
        updateNode(record.id, {
          title: page.title,
          content: page.text,
          status: "ready",
          ...(page.image
            ? {
                metadata: {
                  ...(recordsRef.current[record.id]?.metadata ?? {}),
                  thumbnail: page.image,
                },
              }
            : {}),
        });
      } catch (error) {
        updateNode(record.id, {
          status: "error",
          error: error instanceof Error ? error.message : "Verarbeitung fehlgeschlagen",
        });
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [createRecord, updateNode],
  );

  const addFiles = useCallback(
    async (files: FileList | File[], at?: { x: number; y: number }) => {
      let index = 0;
      for (const file of Array.from(files)) {
        const base = at ?? centerPosition();
        const position = { x: base.x + index * 32, y: base.y + index * 28 };
        index += 1;
        const audio = isAudioFile(file);
        const record = await createRecord({
          type: audio ? "audio" : "document",
          title: file.name,
          mime_type: file.type,
          status: "processing",
          position_x: position.x,
          position_y: position.y,
        });

        try {
          const path = `${user!.id}/${record.id}-${file.name.replace(/[^\w.-]+/g, "_")}`;
          const upload = await supabase.storage.from("uploads").upload(path, file);
          if (upload.error) throw upload.error;
          updateNode(record.id, { storage_path: path });

          const thumbnail = await filePreview(file);
          if (thumbnail) {
            updateNode(record.id, {
              metadata: { ...(recordsRef.current[record.id]?.metadata ?? {}), thumbnail },
            });
          }

          if (audio) {
            if (file.size > 20 * 1024 * 1024) {
              throw new Error("Audiodatei ist zu groß (max. 20 MB direkt hochladen)");
            }
            const base64 = await fileToBase64(file);
            const { text, segments } = await transcribeAudio({
              data: { audioBase64: base64, mimeType: file.type || "audio/mpeg" },
            });
            updateNode(record.id, {
              content: text,
              status: text ? "ready" : "error",
              error: text ? null : "Transkript ist leer",
              ...(segments?.length
                ? { metadata: { ...(recordsRef.current[record.id]?.metadata ?? {}), segments } }
                : {}),
            });
          } else {
            const text = await extractFileText(file);
            const fileSegments = await segmentsFromFile(file, text);
            updateNode(record.id, {
              content: text,
              status: text.trim() ? "ready" : "error",
              error: text.trim() ? null : "Kein Text in der Datei gefunden",
              ...(fileSegments.length
                ? {
                    metadata: {
                      ...(recordsRef.current[record.id]?.metadata ?? {}),
                      segments: fileSegments,
                    },
                  }
                : {}),
            });
          }
        } catch (error) {
          updateNode(record.id, {
            status: "error",
            error: error instanceof Error ? error.message : "Verarbeitung fehlgeschlagen",
          });
        }
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [createRecord, updateNode, user],
  );

  function centerPosition() {
    return screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
  }

  const onConnect = useCallback(
    (connection: Connection) => {
      if (!connection.source || !connection.target) return;
      const source = recordsRef.current[connection.source];
      const target = recordsRef.current[connection.target];
      // connections always run through the group, never its members
      const sourceId = source?.parent_id ?? connection.source;
      const targetId = target?.parent_id ?? connection.target;
      if (sourceId === targetId) return;
      createEdge(sourceId, targetId);
    },
    [createEdge],
  );

  const groupSelection = useCallback(async () => {
    // Formen, Texte und Hintergrundfelder lassen sich mitgruppieren
    const selected = nodes.filter((n) => n.selected && n.type !== "frame" && !n.parentId);
    if (selected.length < 2) {
      toast.info("Mindestens zwei Elemente auswählen (Ziehen oder Shift + Klick)");
      return;
    }
    const padding = 48;
    const minX = Math.min(...selected.map((n) => n.position.x)) - padding;
    const minY = Math.min(...selected.map((n) => n.position.y)) - padding - 24;
    const maxX = Math.max(...selected.map((n) => n.position.x + (n.width ?? 320))) + padding;
    const maxY = Math.max(...selected.map((n) => n.position.y + (n.height ?? 300))) + padding;

    const frame = await createRecord({
      type: "frame",
      title: "Gruppe",
      position_x: minX,
      position_y: minY,
      width: maxX - minX,
      height: maxY - minY,
    });

    const memberIds = new Set(selected.map((n) => n.id));

    for (const node of selected) {
      const relative = { x: node.position.x - minX, y: node.position.y - minY };
      updateNode(node.id, {
        parent_id: frame.id,
        position_x: relative.x,
        position_y: relative.y,
      });
      setNodes((current) =>
        current.map((n) =>
          n.id === node.id
            ? {
                ...n,
                parentId: frame.id,
                extent: "parent" as const,
                position: relative,
                selected: false,
              }
            : n,
        ),
      );
    }

    // rewire existing member connections onto the group
    const outside = new Set<string>();
    for (const edge of edgesRef.current) {
      if (memberIds.has(edge.source) && !memberIds.has(edge.target)) outside.add(edge.target);
      if (memberIds.has(edge.target) && !memberIds.has(edge.source)) outside.add(edge.source);
    }
    const stale = edgesRef.current.filter(
      (e) => memberIds.has(e.source) || memberIds.has(e.target),
    );
    if (stale.length) {
      const ids = stale.map((e) => e.id);
      setEdges((current) => current.filter((e) => !ids.includes(e.id)));
      trackSave(supabase.from("edges").delete().in("id", ids));
    }
    for (const otherId of outside) createEdge(frame.id, otherId);
  }, [nodes, createRecord, updateNode, setNodes, setEdges, createEdge]);

  const openInspector = useCallback((id: string, tab: InspectorTab = "source") => {
    setInspector({ nodeId: id, tab });
  }, []);

  /** The module itself when it carries content, otherwise its connected content modules. */
  const sourcesFor = useCallback((id: string) => {
    const record = recordsRef.current[id];
    if (!record) return [];
    if (!DATA_TYPES.has(record.type)) return [record];
    const neighbours: NodeRecord[] = [record];
    for (const edge of edgesRef.current) {
      const otherId = edge.source === id ? edge.target : edge.target === id ? edge.source : null;
      if (!otherId) continue;
      const other = recordsRef.current[otherId];
      if (!other || other.type === "chat") continue;
      if (other.type === "frame") {
        for (const child of Object.values(recordsRef.current)) {
          if (child.parent_id === other.id) neighbours.push(child);
        }
        continue;
      }
      neighbours.push(other);
    }
    return neighbours;
  }, []);

  const applyStructure = useCallback(
    (id: string, item: StructureItem) => {
      updateNode(id, itemToPatch(item));
    },
    [updateNode],
  );

  const createStructure = useCallback(
    async (item: StructureItem, sourceIds: string[]) => {
      const anchor = recordsRef.current[sourceIds[0] ?? ""];
      const patch = itemToPatch(item);
      const created = await createRecord({
        type: patch.type!,
        title: patch.title ?? item.title,
        content: patch.content ?? "",
        position_x: (anchor?.position_x ?? 0) + 420,
        position_y: (anchor?.position_y ?? 0) + 60,
        metadata: patch.metadata ?? {},
      });
      for (const sourceId of sourceIds) {
        const source = recordsRef.current[sourceId];
        if (source) createEdge(source.parent_id ?? source.id, created.id);
      }
      setInspector({ nodeId: created.id, tab: "data" });
    },
    [createRecord, createEdge],
  );

  const zonesList = useCallback(
    () => Object.values(records).filter((item) => item.type === "zone"),
    [records],
  );

  /** Summarise everything assigned to a background field as a note inside it. */
  const summarizeZone = useCallback(
    async (zone: NodeRecord) => {
      const members = Object.values(recordsRef.current).filter(
        (item) =>
          readAssignment(item)?.zoneId === zone.id &&
          item.type !== "chat" &&
          item.type !== "zone" &&
          item.content,
      );
      if (members.length === 0) {
        toast.info("Diesem Feld ist noch kein Inhalt zugeordnet");
        return;
      }
      const job = toast.loading("Feld wird zusammengefasst …");
      const context = members
        .map((item) => {
          const assignment = readAssignment(item);
          const note = assignment?.note ? ` — Begründung: ${assignment.note}` : "";
          return `### [${zone.title ?? "Feld"} · ${assignment?.role ?? "Beispiel"}]${note} ${item.title ?? "Modul"}\n${(item.content ?? "").slice(0, 60_000)}`;
        })
        .join("\n\n---\n\n");
      try {
        const response = await fetch("/api/chat", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            model: "openai/gpt-6-astra",
            context,
            messages: [
              {
                role: "user",
                content: `Alle Inhalte gehören zum Feld „${zone.title ?? "Feld"}“ eines Canvas. Fasse zusammen, was sie über dieses Feld aussagen, und nenne die Beispiele mit kurzer Begründung.`,
              },
            ],
          }),
        });
        if (!response.ok || !response.body) throw new Error(await response.text());
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let answer = "";
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          answer += decoder.decode(value, { stream: true });
        }
        if (!answer.trim()) throw new Error("Es kam keine Antwort zurück");
        await createRecord({
          type: "note",
          title: `Zusammenfassung: ${zone.title ?? "Feld"}`,
          content: answer,
          position_x: zone.position_x + (zone.width ?? 420) + 40,
          position_y: zone.position_y,
          metadata: { zoneAuto: false },
        });
        toast.success("Zusammenfassung angelegt", { id: job });
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Zusammenfassung fehlgeschlagen", {
          id: job,
        });
      }
    },
    [createRecord],
  );

  const zoneOf = useCallback(
    (id: string) => {
      const record = records[id];
      if (!record) return null;
      const field = zoneLabel(record, records);
      return field ? { title: field.title, role: field.role, color: field.color } : null;
    },
    [records],
  );

  const allNodes = useCallback(() => Object.values(records), [records]);

  const focusNode = useCallback(
    (id: string) => {
      const record = recordsRef.current[id];
      if (!record) return;
      setCenter(
        record.position_x + (record.width ?? 320) / 2,
        record.position_y + (record.height ?? 220) / 2,
        { zoom: 1, duration: 400 },
      );
      setNodes((current) =>
        current.map((node) => ({ ...node, selected: node.id === id })),
      );
    },
    [setCenter, setNodes],
  );

  /** Persist a field size; a template group scales its fields along. */
  const resizeZone = useCallback(
    (id: string, width: number, height: number) => {
      const record = recordsRef.current[id];
      if (!record) return;
      const oldW = record.width ?? 420;
      const oldH = record.height ?? 360;
      updateNode(id, { width, height });
      const children = groupFields(record, Object.values(recordsRef.current));
      if (!children.length || oldW <= 0 || oldH <= 0) return;
      const sx = (width - GROUP_PAD.x * 2) / Math.max(oldW - GROUP_PAD.x * 2, 1);
      const sy =
        (height - GROUP_PAD.top - GROUP_PAD.bottom) /
        Math.max(oldH - GROUP_PAD.top - GROUP_PAD.bottom, 1);
      for (const child of children) {
        const x = GROUP_PAD.x + (child.position_x - GROUP_PAD.x) * sx;
        const y = GROUP_PAD.top + (child.position_y - GROUP_PAD.top) * sy;
        const w = Math.max((child.width ?? 200) * sx, 80);
        const h = Math.max((child.height ?? 160) * sy, 60);
        updateNode(child.id, { position_x: x, position_y: y, width: w, height: h });
        setNodes((current) =>
          current.map((node) =>
            node.id === child.id ? { ...node, position: { x, y }, width: w, height: h } : node,
          ),
        );
      }
    },
    [updateNode, setNodes],
  );

  /** Place a template as a group of white fields at the given canvas position. */
  const insertTemplate = useCallback(
    async (template: Template, x: number, y: number) => {
      // fields should comfortably hold several cards, so place templates at double size
      const scale = TEMPLATE_SCALE;
      const bounds = templateBounds(template.fields);
      const width = bounds.width * scale + GROUP_PAD.x * 2;
      const height = bounds.height * scale + GROUP_PAD.top + GROUP_PAD.bottom;
      const container = await createRecord({
        type: "zone",
        title: template.title,
        color: ZONE_WHITE,
        position_x: x,
        position_y: y,
        width,
        height,
        metadata: { templateGroup: true, zoneAuto: false },
      });
      for (const field of template.fields) {
        await createRecord({
          type: "zone",
          title: field.title,
          color: ZONE_WHITE,
          parent_id: container.id,
          position_x: GROUP_PAD.x + field.x * scale,
          position_y: GROUP_PAD.top + field.y * scale,
          width: field.w * scale,
          height: field.h * scale,
        });
      }
      // bring the fresh template fully into view
      const zoom = Math.min(
        1,
        Math.max(0.2, Math.min(window.innerWidth / (width + 160), window.innerHeight / (height + 240))),
      );
      setCenter(x + width / 2, y + height / 2, { zoom, duration: 500 });
      toast.success(`${template.title} eingefügt`);
    },
    [createRecord, setCenter],
  );

  /** Fields of the selected template group, otherwise every field on the board. */
  const currentFields = useCallback((): TemplateField[] => {
    const all = Object.values(recordsRef.current);
    const selectedId = nodes.find((n) => n.selected && n.type === "zone")?.id;
    const selected = selectedId ? recordsRef.current[selectedId] : undefined;
    const group = selected?.parent_id ? recordsRef.current[selected.parent_id] : selected;
    const list = group ? groupFields(group, all) : [];
    const source = list.length ? list : absoluteZones(all).filter((z) => !z.parent_id);
    if (!source.length) return [];
    const minX = Math.min(...source.map((z) => z.position_x));
    const minY = Math.min(...source.map((z) => z.position_y));
    return source.map((zone) => ({
      title: zone.title ?? "Feld",
      x: Math.round(zone.position_x - minX),
      y: Math.round(zone.position_y - minY),
      w: Math.round(zone.width ?? 320),
      h: Math.round(zone.height ?? 260),
    }));
  }, [nodes]);

  /** Save a group of fields on the canvas as an own template. */
  const saveGroupAsTemplate = useCallback(
    async (record: NodeRecord) => {
      if (!user) return;
      const all = Object.values(recordsRef.current);
      const group = record.parent_id ? recordsRef.current[record.parent_id] ?? record : record;
      const list = groupFields(group, all);
      const source = list.length ? list : [group];
      const minX = Math.min(...source.map((z) => z.position_x));
      const minY = Math.min(...source.map((z) => z.position_y));
      const fields: TemplateField[] = source.map((zone) => ({
        title: zone.title ?? "Feld",
        x: Math.round(zone.position_x - minX),
        y: Math.round(zone.position_y - minY),
        w: Math.round(zone.width ?? 320),
        h: Math.round(zone.height ?? 260),
      }));
      const { error } = await supabase.from("templates").insert({
        user_id: user.id,
        title: group.title ?? "Eigene Vorlage",
        description: `${fields.length} Felder`,
        fields: fields as never,
      } as never);
      if (error) {
        toast.error(error.message);
        return;
      }
      toast.success("Als eigene Vorlage gespeichert");
    },
    [user],
  );

  const api = useMemo(
    () => ({
      updateNode,
      deleteNode,
      collectContext,
      contextReport,
      addNoteFrom,
      extractStructure,
      openInspector,
      sourcesFor,
      applyStructure,
      createStructure,
      zones: zonesList,
      zoneOf,
      allNodes,
      focusNode,
      resizeZone,
    }),
    [
      updateNode,
      deleteNode,
      collectContext,
      addNoteFrom,
      extractStructure,
      openInspector,
      sourcesFor,
      applyStructure,
      createStructure,
      zonesList,
      zoneOf,
      allNodes,
      focusNode,
      resizeZone,
    ],
  );

  useEffect(() => {
    function onPaste(event: ClipboardEvent) {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;
      const text = event.clipboardData?.getData("text")?.trim();
      if (text && /^https?:\/\//i.test(text)) void addUrl(text);
    }
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [addUrl]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "g") {
        event.preventDefault();
        void groupSelection();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [groupSelection]);

  if (loading || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center text-muted-foreground">…</div>
    );
  }

  const menuRecord = menu?.nodeId ? records[menu.nodeId] : undefined;

  const menuItems = menuRecord?.type === "text"
    ? [
        ...TEXT_SIZES.map((size) => ({
          label: size.label,
          active: textSize(menuRecord).id === size.id,
          run: () =>
            updateNode(menuRecord.id, {
              metadata: { ...(menuRecord.metadata ?? {}), textSize: size.id },
            }),
        })),
        { label: "Text löschen", run: () => deleteNode(menuRecord.id) },
      ]
    : menuRecord?.type === "shape"
    ? [
        ...SHAPES.map((shape) => ({
          label: shape.label,
          active: shapeKind(menuRecord).id === shape.id,
          run: () =>
            updateNode(menuRecord.id, {
              metadata: { ...(menuRecord.metadata ?? {}), shape: shape.id },
            }),
        })),
        ...ZONE_COLORS.map((shapeColor) => ({
          label: shapeColor.name,
          swatch: shapeColor.value,
          active: (menuRecord.color ?? "var(--chat)") === shapeColor.value,
          run: () => updateNode(menuRecord.id, { color: shapeColor.value }),
        })),
        {
          label: "90° drehen",
          run: () =>
            updateNode(menuRecord.id, {
              metadata: {
                ...(menuRecord.metadata ?? {}),
                rotation:
                  ((Number((menuRecord.metadata as Record<string, unknown> | null)?.["rotation"] ?? 0) + 90) % 360),
              },
            }),
        },
        { label: "Form löschen", run: () => deleteNode(menuRecord.id) },
      ]
    : menuRecord?.type === "zone"
    ? [
        {
          label: "Chat zu diesem Feld",
          icon: MessageSquare,
          run: () =>
            void createRecord({
              type: "chat",
              title: `Chat: ${menuRecord.title ?? "Feld"}`,
              position_x: menuRecord.position_x + 24,
              position_y: menuRecord.position_y + 56,
              metadata: { model: "openai/gpt-6-astra", zoneId: menuRecord.id, zoneAuto: false },
            }).catch((error: unknown) =>
              toast.error(error instanceof Error ? error.message : "Chat konnte nicht angelegt werden"),
            ),
        },
        {
          label: "Inhalte des Feldes zusammenfassen",
          icon: NotebookPen,
          run: () => void summarizeZone(menuRecord),
        },
        {
          label: "Als eigene Vorlage speichern",
          icon: PanelsTopLeft,
          run: () => void saveGroupAsTemplate(menuRecord),
        },
        {
          label: "Vorlagen verwalten …",
          icon: PanelsTopLeft,
          run: () => setTemplateOpen(true),
        },
        {
          label:
            (menuRecord.metadata as Record<string, unknown> | null)?.["locked"] === true
              ? "Feld entsperren"
              : "Feld sperren",
          icon:
            (menuRecord.metadata as Record<string, unknown> | null)?.["locked"] === true
              ? LockOpen
              : Lock,
          run: () =>
            updateNode(menuRecord.id, {
              metadata: {
                ...(menuRecord.metadata ?? {}),
                locked:
                  (menuRecord.metadata as Record<string, unknown> | null)?.["locked"] !== true,
              },
            }),
        },
        ...ZONE_COLORS.map((zoneColor) => ({
          label: zoneColor.name,
          swatch: zoneColor.value,
          active: (menuRecord.color ?? ZONE_WHITE) === zoneColor.value,
          run: () => updateNode(menuRecord.id, { color: zoneColor.value }),
        })),
        { label: "Feld löschen", run: () => deleteNode(menuRecord.id) },
      ]
    : menu?.nodeId
    ? [
        {
          label: "Im Kontextfenster öffnen",
          icon: PanelsTopLeft,
          run: () => openInspector(menu.nodeId!),
        },
        {
          label: "Strukturierte Daten herauslösen",
          icon: Workflow,
          run: () => extractStructure(menu.nodeId!),
        },
        {
          label: "Notiz daneben anlegen",
          icon: NotebookPen,
          run: () =>
            void createRecord({
              type: "note",
              title: "Notiz",
              content: "",
              position_x: menu.flowX + 40,
              position_y: menu.flowY + 40,
            }),
        },
        { label: "Modul löschen", run: () => deleteNode(menu.nodeId!) },
      ]
    : [
        {
          label: "Link einfügen …",
          icon: Link2,
          run: () => setLinkPrompt({ x: menu?.flowX ?? 0, y: menu?.flowY ?? 0 }),
        },
        {
          label: "Datei hochladen …",
          icon: Upload,
          run: () => {
            filePosition.current = { x: menu?.flowX ?? 0, y: menu?.flowY ?? 0 };
            fileRef.current?.click();
          },
        },
        {
          label: "Notiz",
          icon: NotebookPen,
          run: () =>
            void createRecord({
              type: "note",
              title: "Notiz",
              content: "",
              position_x: menu?.flowX ?? 0,
              position_y: menu?.flowY ?? 0,
            }),
        },
        {
          label: "Chat-Modul",
          icon: MessageSquare,
          run: () =>
            void createRecord({
              type: "chat",
              title: "Chat",
              position_x: menu?.flowX ?? 0,
              position_y: menu?.flowY ?? 0,
              metadata: { model: "openai/gpt-6-astra" },
            }),
        },
        {
          label: "Text",
          icon: Type,
          run: () =>
            void createRecord({
              type: "text",
              title: "Text",
              content: "",
              position_x: menu?.flowX ?? 0,
              position_y: menu?.flowY ?? 0,
            }),
        },
        {
          label: "Hintergrundfeld",
          icon: PanelsTopLeft,
          run: () =>
            void createRecord({
              type: "zone",
              title: "Feld",
              color: ZONE_WHITE,
              position_x: menu?.flowX ?? 0,
              position_y: menu?.flowY ?? 0,
            }).catch((error: unknown) =>
              toast.error(error instanceof Error ? error.message : "Feld konnte nicht angelegt werden"),
            ),
        },
        {
          label: "Vorlage einfügen …",
          icon: PanelsTopLeft,
          run: () => {
            templatePosition.current = { x: menu?.flowX ?? 0, y: menu?.flowY ?? 0 };
            setTemplateOpen(true);
          },
        },
        { label: "Auswahl gruppieren", icon: Workflow, run: () => void groupSelection() },
      ];

  return (
    <div className="flex h-screen flex-col bg-canvas">
      <header className="z-10 flex h-14 items-center gap-2 border-b border-border/70 bg-card/90 px-3 backdrop-blur">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button asChild size="icon" variant="ghost" className="size-9 rounded-lg">
              <Link to="/" aria-label="Zur Board-Übersicht">
                <ArrowLeft className="size-4" />
              </Link>
            </Button>
          </TooltipTrigger>
          <TooltipContent>Zur Board-Übersicht</TooltipContent>
        </Tooltip>
        <div className="h-5 w-px bg-border/70" />
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => trackSave(supabase.from("boards").update({ title }).eq("id", boardId))}
          aria-label="Board-Titel"
          className="h-9 min-w-0 max-w-72 border-transparent bg-transparent font-display text-base font-semibold shadow-none focus-visible:border-input"
        />
        <SaveIndicator />
        <div className="ml-auto flex items-center gap-1">
          {isOwner ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-9 rounded-lg"
                  aria-label="Board teilen"
                  onClick={() => setShareOpen(true)}
                >
                  <Share2 className="size-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Board teilen</TooltipContent>
            </Tooltip>
          ) : (
            <span className="rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground">
              Geteiltes Board
            </span>
          )}
        </div>
      </header>

      <ShareDialog boardId={boardId} open={shareOpen} onOpenChange={setShareOpen} />

      <TemplateDialog
        open={templateOpen}
        onOpenChange={setTemplateOpen}
        userId={user?.id}
        currentFields={currentFields}
        onInsert={async (template) => {
          const at =
            templatePosition.current ??
            screenToFlowPosition({ x: window.innerWidth / 2 - 400, y: 240 });
          templatePosition.current = null;
          try {
            await insertTemplate(template, at.x, at.y);
          } catch (error) {
            toast.error(error instanceof Error ? error.message : "Vorlage fehlgeschlagen");
          }
        }}
      />


      <input
        ref={fileRef}
        type="file"
        multiple
        accept=".pdf,.pptx,.docx,.txt,.md,audio/*"
        className="hidden"
        onChange={(e) => {
          if (e.target.files?.length) {
            void addFiles(e.target.files, filePosition.current ?? undefined);
          }
          filePosition.current = null;
          e.target.value = "";
        }}
      />

      <div
        className="relative flex min-h-0 flex-1"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          const at = screenToFlowPosition({ x: e.clientX, y: e.clientY });
          if (e.dataTransfer.files.length) void addFiles(e.dataTransfer.files, at);
          else {
            const text = e.dataTransfer.getData("text");
            if (text) void addUrl(text, at);
          }
        }}
      >
        <BoardContext.Provider value={api}>
          <div className="relative min-w-0 flex-1">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeDragStop={(_, node) => {
              updateNode(node.id, { position_x: node.position.x, position_y: node.position.y });
              syncZone(node.id, node.position.x, node.position.y);
            }}
            onNodesDelete={(deleted) => deleted.forEach((n) => deleteNode(n.id))}
            onEdgesDelete={(deleted) => {
              deleted.forEach((e) => trackSave(supabase.from("edges").delete().eq("id", e.id)));
            }}
            onPaneClick={() => setMenu(null)}
            onMoveStart={() => setMenu(null)}
            onPaneContextMenu={(event) => {
              event.preventDefault();
              const mouse = event as unknown as MouseEvent;
              const flow = screenToFlowPosition({ x: mouse.clientX, y: mouse.clientY });
              setMenu({ x: mouse.clientX, y: mouse.clientY, flowX: flow.x, flowY: flow.y });
            }}
            onNodeContextMenu={(event, node) => {
              event.preventDefault();
              const flow = screenToFlowPosition({ x: event.clientX, y: event.clientY });
              setMenu({
                x: event.clientX,
                y: event.clientY,
                flowX: flow.x,
                flowY: flow.y,
                nodeId: node.id,
              });
            }}
            fitView={ready}
            minZoom={0.15}
            maxZoom={2.5}
            selectionOnDrag
            selectionMode={SelectionMode.Partial}
            multiSelectionKeyCode={["Meta", "Control", "Shift"]}
            panOnScroll
            proOptions={{ hideAttribution: true }}
          >
            <Background
              variant={BackgroundVariant.Dots}
              gap={22}
              size={1.6}
              color="var(--canvas-dot)"
            />
            <Controls showInteractive={false} />
            <MiniMap pannable zoomable className="!bg-card" />
          </ReactFlow>

          <div className="pointer-events-none absolute inset-x-0 bottom-5 z-20 flex justify-center px-4">
            <div className="pointer-events-auto flex max-w-full items-center gap-1 overflow-x-auto rounded-2xl border border-border/70 bg-card/95 p-1.5 shadow-[var(--shadow-float)] backdrop-blur">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="icon"
                    variant="ghost"
                    className={toolBtn(templateOpen)}
                    aria-label="Vorlagen"
                    aria-pressed={templateOpen}
                    onClick={() => {
                      templatePosition.current = null;
                      setTemplateOpen(true);
                    }}
                  >
                    <LayoutTemplate className="size-5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="top">Vorlagen</TooltipContent>
              </Tooltip>

              <div className="mx-1 h-6 w-px shrink-0 bg-border/70" />

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="icon"
                    variant="ghost"
                    className={toolBtn()}
                    aria-label="Link einfügen"
                    onClick={() => {
                      const at = screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
                      setLinkPrompt(at);
                    }}
                  >
                    <Link2 className="size-5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="top">Link einfügen</TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="icon"
                    variant="ghost"
                    className={toolBtn()}
                    aria-label="Datei hochladen"
                    onClick={() => {
                      filePosition.current = screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
                      fileRef.current?.click();
                    }}
                  >
                    <FileUp className="size-5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="top">Datei hochladen</TooltipContent>
              </Tooltip>

              <DropdownMenu>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <DropdownMenuTrigger asChild>
                      <Button
                        size="icon"
                        variant="ghost"
                        className={toolBtn()}
                        aria-label="Form einfügen"
                      >
                        <Shapes className="size-5" />
                      </Button>
                    </DropdownMenuTrigger>
                  </TooltipTrigger>
                  <TooltipContent side="top">Form einfügen</TooltipContent>
                </Tooltip>
                <DropdownMenuContent side="top" align="center">
                  {SHAPES.map((shape) => (
                    <DropdownMenuItem
                      key={shape.id}
                      onSelect={() => {
                        const at = screenToFlowPosition({
                          x: window.innerWidth / 2,
                          y: window.innerHeight / 2,
                        });
                        void createRecord({
                          type: "shape",
                          title: shape.label,
                          content: "",
                          color: "var(--chat)",
                          position_x: at.x,
                          position_y: at.y,
                          metadata: { shape: shape.id },
                        });
                      }}
                    >
                      {shape.label}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="icon"
                    variant="ghost"
                    className={toolBtn()}
                    aria-label="Text einfügen"
                    onClick={() => {
                      const at = screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
                      void createRecord({ type: "text", title: "Text", content: "", position_x: at.x, position_y: at.y });
                    }}
                  >
                    <Type className="size-5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="top">Text einfügen</TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="icon"
                    variant="ghost"
                    className={toolBtn()}
                    aria-label="Notiz anlegen"
                    onClick={() => {
                      const at = screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
                      void createRecord({ type: "note", title: "Notiz", content: "", position_x: at.x, position_y: at.y });
                    }}
                  >
                    <StickyNote className="size-5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="top">Notiz anlegen</TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="icon"
                    className={toolBtn()}
                    aria-label="Chat-Modul anlegen"
                    onClick={() => {
                      const at = screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
                      void createRecord({
                        type: "chat",
                        title: "Chat",
                        position_x: at.x,
                        position_y: at.y,
                        metadata: { model: "openai/gpt-6-astra" },
                      });
                    }}
                  >
                    <MessageSquare className="size-5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="top">Chat-Modul anlegen</TooltipContent>
              </Tooltip>
            </div>
          </div>
          </div>

          {inspector && (
            <InspectorPanel
              key={inspector.nodeId}
              nodeId={inspector.nodeId}
              tab={inspector.tab}
              onTab={(tab) => setInspector((current) => (current ? { ...current, tab } : current))}
              onClose={() => setInspector(null)}
            />
          )}
        </BoardContext.Provider>

        {menu && (
          <div
            className="fixed z-50 w-64 overflow-hidden rounded-xl border border-border/70 bg-popover p-1.5 text-sm text-popover-foreground shadow-[var(--shadow-float)]"
            style={{ left: menu.x, top: menu.y }}
            onMouseLeave={() => setMenu(null)}
          >
            {menuItems.map((item) => {
              const Icon = "icon" in item ? item.icon : null;
              return (
                <button
                  key={item.label}
                  className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
                  onClick={() => {
                    setMenu(null);
                    item.run();
                  }}
                >
                  {Icon ? <Icon className="size-4 shrink-0 text-muted-foreground" /> : null}
                  {"swatch" in item && item.swatch ? (
                    <span
                      className="size-3 shrink-0 rounded-full border"
                      style={{ backgroundColor: item.swatch as string }}
                    />
                  ) : null}
                  <span className="flex-1">{item.label}</span>
                  {"active" in item && item.active ? <Check className="size-3.5 text-primary" /> : null}
                </button>
              );
            })}
          </div>
        )}

        {linkPrompt && (
          <div className="absolute inset-0 z-50 flex items-start justify-center bg-background/40 pt-32">
            <div className="w-96 rounded-2xl border border-border/70 bg-card p-5 shadow-[var(--shadow-float)]">
              <p className="mb-1 font-display text-lg font-semibold">Link einfügen</p>
              <p className="mb-4 text-sm text-muted-foreground">Füge einen Link zu einem Video, Podcast oder Artikel ein.</p>
              <Input
                autoFocus
                value={linkValue}
                placeholder="https://…"
                onChange={(e) => setLinkValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    void addUrl(linkValue, linkPrompt);
                    setLinkValue("");
                    setLinkPrompt(null);
                  }
                  if (e.key === "Escape") setLinkPrompt(null);
                }}
              />
              <div className="mt-3 flex justify-end gap-2">
                <Button size="sm" variant="ghost" className="rounded-full" onClick={() => setLinkPrompt(null)}>
                  Abbrechen
                </Button>
                <Button
                  size="sm"
                  className="rounded-full"
                  onClick={() => {
                    void addUrl(linkValue, linkPrompt);
                    setLinkValue("");
                    setLinkPrompt(null);
                  }}
                >
                  Hinzufügen
                </Button>
              </div>
            </div>
          </div>
        )}

        {ready && nodes.length === 0 && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <p className="max-w-sm rounded-2xl border border-dashed bg-card/80 px-6 py-5 text-center text-sm text-muted-foreground">
              Rechtsklick auf die Fläche öffnet das Menü – oder füge einen Link mit Strg+V ein und
              ziehe Dateien direkt hierher.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function fileToBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Datei konnte nicht gelesen werden"));
    reader.onload = () => {
      const result = String(reader.result);
      resolve(result.slice(result.indexOf(",") + 1));
    };
    reader.readAsDataURL(file);
  });
}

function SaveIndicator() {
  const { status, lastSavedAt, lastError } = useSaveStatus();
  const time = lastSavedAt
    ? new Date(lastSavedAt).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })
    : null;
  const config =
    status === "saving"
      ? { icon: CloudUpload, text: "Speichert …", className: "text-muted-foreground", spin: true }
      : status === "error"
        ? { icon: CloudOff, text: "Fehler beim Speichern", className: "text-destructive", spin: false }
        : status === "saved"
          ? { icon: CloudCheck, text: `Gespeichert${time ? ` · ${time}` : ""}`, className: "text-muted-foreground", spin: false }
          : null;
  if (!config) return null;
  const Icon = config.icon;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-live="polite"
          onClick={() => status === "error" && clearSaveError()}
          className={cn(
            "flex h-7 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium transition-colors",
            config.className,
            status === "error" && "hover:bg-destructive/10",
          )}
        >
          <Icon className={cn("size-3.5", config.spin && "animate-pulse")} />
          <span>{config.text}</span>
        </button>
      </TooltipTrigger>
      <TooltipContent>
        {status === "error"
          ? `${lastError ?? "Unbekannter Fehler"} – zum Ausblenden klicken`
          : status === "saving"
            ? "Änderungen werden in der Cloud gespeichert"
            : "Alle Änderungen sind gespeichert"}
      </TooltipContent>
    </Tooltip>
  );
}
