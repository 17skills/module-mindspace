import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Background,
  BackgroundVariant,
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
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  BoardContext,
  type InspectorTab,
  type NodeRecord,
  type StructureItem,
} from "@/components/canvas/board-context";
import { ChatNode, ContentNode, DataNode, FrameNode, NoteNode } from "@/components/canvas/nodes";
import { InspectorPanel } from "@/components/canvas/inspector/InspectorPanel";
import { extractFileText, isAudioFile, youtubeId } from "@/lib/extract";
import { filePreview } from "@/lib/preview";
import { itemToPatch } from "@/lib/structure";

import {
  extractStructured,
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
};

const DATA_TYPES = new Set(["table", "list", "chart"]);

const DEFAULT_SIZE: Record<string, { width: number; height: number }> = {
  note: { width: 260, height: 200 },
  chat: { width: 400, height: 460 },
  frame: { width: 640, height: 460 },
  table: { width: 400, height: 300 },
  list: { width: 300, height: 280 },
  chart: { width: 400, height: 320 },
  default: { width: 320, height: 340 },
};

function toFlowNode(record: NodeRecord): Node {
  const size = DEFAULT_SIZE[record.type] ?? DEFAULT_SIZE["default"]!;
  const kind =
    record.type === "note" || record.type === "chat" || record.type === "frame"
      ? record.type
      : DATA_TYPES.has(record.type)
        ? "data"
        : "content";
  return {
    id: record.id,
    type: kind,
    position: { x: record.position_x, y: record.position_y },
    width: record.width ?? size.width,
    height: record.height ?? size.height,
    data: { record },
    ...(record.parent_id ? { parentId: record.parent_id, extent: "parent" as const } : {}),
    ...(kind === "frame" ? { zIndex: -1 } : {}),
  };
}

/** Frames must come before their children in the node array. */
function sortNodes(list: NodeRecord[]) {
  return [...list].sort((a, b) => (a.type === "frame" ? -1 : 0) - (b.type === "frame" ? -1 : 0));
}

type Menu = { x: number; y: number; flowX: number; flowY: number; nodeId?: string };

function BoardPage() {
  const { boardId } = Route.useParams();
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const { screenToFlowPosition } = useReactFlow();

  const [title, setTitle] = useState("");
  const [records, setRecords] = useState<Record<string, NodeRecord>>({});
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [ready, setReady] = useState(false);
  const [menu, setMenu] = useState<Menu | null>(null);
  const [inspector, setInspector] = useState<{ nodeId: string; tab: InspectorTab } | null>(null);
  const [linkPrompt, setLinkPrompt] = useState<{ x: number; y: number } | null>(null);
  const [linkValue, setLinkValue] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const filePosition = useRef<{ x: number; y: number } | null>(null);
  const recordsRef = useRef(records);
  recordsRef.current = records;
  const edgesRef = useRef(edges);
  edgesRef.current = edges;

  useEffect(() => {
    if (!loading && !user) void navigate({ to: "/auth" });
  }, [loading, user, navigate]);

  useEffect(() => {
    if (!user) return;
    let active = true;
    void (async () => {
      const [boardRes, nodeRes, edgeRes] = await Promise.all([
        supabase.from("boards").select("title").eq("id", boardId).single(),
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
          void supabase.from("edges").update({ source_id: source, target_id: target }).eq("id", id);
        }
      }
      if (drop.length) void supabase.from("edges").delete().in("id", drop);
      setEdges(keep);
      setReady(true);
    })();
    return () => {
      active = false;
    };
  }, [boardId, user, navigate, setNodes, setEdges]);

  // keep node data in sync with records
  useEffect(() => {
    setNodes((current) =>
      current.map((node) => {
        const record = records[node.id];
        return record ? { ...node, data: { record } } : node;
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
      void supabase
        .from("nodes")
        .update(patch as never)
        .eq("id", id)
        .then(({ error }) => {
          if (error) toast.error(error.message);
        });
    },
    [patchRecord],
  );

  const deleteNode = useCallback(
    (id: string) => {
      setNodes((current) => current.filter((n) => n.id !== id && n.parentId !== id));
      setEdges((current) => current.filter((e) => e.source !== id && e.target !== id));
      setRecords((current) => {
        const next = { ...current };
        delete next[id];
        return next;
      });
      void supabase.from("nodes").delete().eq("id", id);
    },
    [setNodes, setEdges],
  );

  const createRecord = useCallback(
    async (input: Partial<NodeRecord> & { type: string }) => {
      if (!user) throw new Error("Nicht angemeldet");
      const size = DEFAULT_SIZE[input.type] ?? DEFAULT_SIZE["default"]!;
      const payload = {
        board_id: boardId,
        user_id: user.id,
        type: input.type,
        title: input.title ?? null,
        position_x: input.position_x ?? 0,
        position_y: input.position_y ?? 0,
        width: input.width ?? size.width,
        height: input.height ?? size.height,
        source_url: input.source_url ?? null,
        storage_path: input.storage_path ?? null,
        mime_type: input.mime_type ?? null,
        content: input.content ?? null,
        status: input.status ?? "ready",
        metadata: input.metadata ?? {},
      };
      const { data, error } = await supabase
        .from("nodes")
        .insert(payload as never)
        .select("*")
        .single();
      if (error) throw error;
      const record = data as unknown as NodeRecord;
      setRecords((current) => ({ ...current, [record.id]: record }));
      setNodes((current) =>
        record.type === "frame" ? [toFlowNode(record), ...current] : [...current, toFlowNode(record)],
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
      void supabase
        .from("edges")
        .insert({
          id,
          board_id: boardId,
          user_id: user.id,
          source_id: sourceId,
          target_id: targetId,
        } as never)
        .then(({ error }) => {
          if (error) toast.error(error.message);
        });
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
    const parts: string[] = [];
    for (const nodeId of connected) {
      const record = recordsRef.current[nodeId];
      if (!record || record.type === "chat" || record.type === "frame") continue;
      if (!record.content) continue;
      parts.push(
        `### ${record.title ?? "Modul"} (${record.type}${record.source_url ? `, ${record.source_url}` : ""})\n${record.content.slice(0, 60_000)}`,
      );
    }
    return parts.join("\n\n---\n\n");
  }, []);

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

      const record = await createRecord({
        type: isYoutube ? "youtube" : isAudioUrl || isFeed ? "podcast" : "link",
        title: url,
        source_url: url,
        status: "processing",
        position_x: position.x,
        position_y: position.y,
      });

      try {
        if (isYoutube) {
          const info = await fetchYoutube({ data: { url } });
          updateNode(record.id, {
            title: info.title,
            content: info.transcript,
            status: info.transcript ? "ready" : "error",
            error: info.transcript ? null : info.transcriptError,
            metadata: { thumbnail: info.thumbnail, author: info.author },
          });
          return;
        }

        if (isAudioUrl || isFeed) {
          const episode = isAudioUrl
            ? { title: url.split("/").pop() ?? "Audio", audioUrl: url, image: null }
            : await resolvePodcast({ data: { url } });
          updateNode(record.id, {
            title: episode.title,
            ...(episode.image ? { metadata: { thumbnail: episode.image } } : {}),
          });
          const { text } = await transcribeAudio({ data: { audioUrl: episode.audioUrl } });
          updateNode(record.id, {
            content: text,
            status: text ? "ready" : "error",
            error: text ? null : "Transkript ist leer",
          });
          return;
        }

        const page = await fetchPageText({ data: { url } });
        updateNode(record.id, {
          title: page.title,
          content: page.text,
          status: "ready",
          ...(page.image ? { metadata: { thumbnail: page.image } } : {}),
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
          if (thumbnail) updateNode(record.id, { metadata: { thumbnail } });

          if (audio) {
            if (file.size > 20 * 1024 * 1024) {
              throw new Error("Audiodatei ist zu groß (max. 20 MB direkt hochladen)");
            }
            const base64 = await fileToBase64(file);
            const { text } = await transcribeAudio({
              data: { audioBase64: base64, mimeType: file.type || "audio/mpeg" },
            });
            updateNode(record.id, {
              content: text,
              status: text ? "ready" : "error",
              error: text ? null : "Transkript ist leer",
            });
          } else {
            const text = await extractFileText(file);
            updateNode(record.id, {
              content: text,
              status: text.trim() ? "ready" : "error",
              error: text.trim() ? null : "Kein Text in der Datei gefunden",
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
    const selected = nodes.filter((n) => n.selected && n.type !== "frame" && !n.parentId);
    if (selected.length < 2) {
      toast.info("Mindestens zwei Module auswählen (Shift + Ziehen)");
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
      void supabase.from("edges").delete().in("id", ids);
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
    if (!DATA_TYPES.includes(record.type)) return [record];
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

  const api = useMemo(
    () => ({
      updateNode,
      deleteNode,
      collectContext,
      addNoteFrom,
      extractStructure,
      openInspector,
      sourcesFor,
      applyStructure,
      createStructure,
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

  if (loading || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center text-muted-foreground">…</div>
    );
  }

  const menuItems = menu?.nodeId
    ? [
        {
          label: "Im Kontextfenster öffnen",
          run: () => openInspector(menu.nodeId!),
        },
        {
          label: "Strukturierte Daten herauslösen",
          run: () => extractStructure(menu.nodeId!),
        },
        {
          label: "Notiz daneben anlegen",
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
          run: () => setLinkPrompt({ x: menu?.flowX ?? 0, y: menu?.flowY ?? 0 }),
        },
        {
          label: "Datei hochladen …",
          run: () => {
            filePosition.current = { x: menu?.flowX ?? 0, y: menu?.flowY ?? 0 };
            fileRef.current?.click();
          },
        },
        {
          label: "Notiz",
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
          run: () =>
            void createRecord({
              type: "chat",
              title: "Chat",
              position_x: menu?.flowX ?? 0,
              position_y: menu?.flowY ?? 0,
              metadata: { model: "openai/gpt-6-astra" },
            }),
        },
        { label: "Auswahl gruppieren", run: () => void groupSelection() },
      ];

  return (
    <div className="flex h-screen flex-col bg-canvas">
      <header className="z-10 flex items-center gap-3 border-b bg-card/80 px-4 py-2.5 backdrop-blur">
        <Link to="/" className="text-sm text-muted-foreground hover:text-foreground">
          ← Boards
        </Link>
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => void supabase.from("boards").update({ title }).eq("id", boardId)}
          className="h-8 w-56 border-transparent bg-transparent font-display text-base font-semibold shadow-none focus-visible:border-input"
        />
        <span className="ml-auto text-xs text-muted-foreground">
          Rechtsklick auf die Fläche für neue Module
        </span>
      </header>

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
            }}
            onNodesDelete={(deleted) => deleted.forEach((n) => deleteNode(n.id))}
            onEdgesDelete={(deleted) => {
              deleted.forEach((e) => void supabase.from("edges").delete().eq("id", e.id));
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
            className="fixed z-50 w-60 overflow-hidden rounded-xl border bg-popover py-1 text-sm shadow-lg"
            style={{ left: menu.x, top: menu.y }}
            onMouseLeave={() => setMenu(null)}
          >
            {menuItems.map((item) => (
              <button
                key={item.label}
                className="block w-full px-3 py-1.5 text-left hover:bg-secondary"
                onClick={() => {
                  setMenu(null);
                  item.run();
                }}
              >
                {item.label}
              </button>
            ))}
          </div>
        )}

        {linkPrompt && (
          <div className="absolute inset-0 z-50 flex items-start justify-center bg-background/40 pt-32">
            <div className="w-96 rounded-2xl border bg-card p-4 shadow-lg">
              <p className="mb-2 text-sm font-medium">Link einfügen</p>
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
                <Button size="sm" variant="ghost" onClick={() => setLinkPrompt(null)}>
                  Abbrechen
                </Button>
                <Button
                  size="sm"
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
