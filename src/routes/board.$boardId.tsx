import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  addEdge,
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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { BoardContext, type NodeRecord } from "@/components/canvas/board-context";
import { ChatNode, ContentNode, FrameNode, NoteNode } from "@/components/canvas/nodes";
import { extractFileText, isAudioFile, youtubeId } from "@/lib/extract";
import {
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
};

const DEFAULT_SIZE: Record<string, { width: number; height: number }> = {
  note: { width: 260, height: 200 },
  chat: { width: 400, height: 460 },
  frame: { width: 640, height: 460 },
  default: { width: 320, height: 300 },
};

function toFlowNode(record: NodeRecord): Node {
  const size = DEFAULT_SIZE[record.type] ?? DEFAULT_SIZE["default"]!;
  const kind =
    record.type === "note" || record.type === "chat" || record.type === "frame"
      ? record.type
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

function BoardPage() {
  const { boardId } = Route.useParams();
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const { screenToFlowPosition } = useReactFlow();

  const [title, setTitle] = useState("");
  const [records, setRecords] = useState<Record<string, NodeRecord>>({});
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [urlInput, setUrlInput] = useState("");
  const [ready, setReady] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
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
      setNodes(list.map(toFlowNode));
      setEdges(
        (edgeRes.data ?? []).map((e) => ({
          id: e.id as string,
          source: e.source_id as string,
          target: e.target_id as string,
          animated: true,
        })),
      );
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
      setNodes((current) => [...current, toFlowNode(record)]);
      return record;
    },
    [boardId, user, setNodes],
  );

  const nextPosition = useCallback(() => {
    const center = screenToFlowPosition({
      x: window.innerWidth / 2,
      y: window.innerHeight / 2,
    });
    const jitter = Object.keys(recordsRef.current).length % 6;
    return { x: center.x - 160 + jitter * 28, y: center.y - 150 + jitter * 24 };
  }, [screenToFlowPosition]);

  const collectContext = useCallback(
    (id: string) => {
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
    },
    [],
  );

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

  const addUrl = useCallback(
    async (rawUrl: string) => {
      const url = rawUrl.trim();
      if (!url) return;
      let parsed: URL;
      try {
        parsed = new URL(url);
      } catch {
        toast.error("Das ist keine gültige Adresse");
        return;
      }

      const position = nextPosition();
      const isYoutube = Boolean(youtubeId(url));
      const isAudioUrl = /\.(mp3|m4a|wav|aac|ogg)(\?|$)/i.test(parsed.pathname);
      const isFeed = /\/(rss|feed)/i.test(parsed.pathname) || /podcast|spotify|apple/i.test(parsed.hostname);

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
            ? { title: url.split("/").pop() ?? "Audio", audioUrl: url }
            : await resolvePodcast({ data: { url } });
          updateNode(record.id, { title: episode.title });
          const { text } = await transcribeAudio({ data: { audioUrl: episode.audioUrl } });
          updateNode(record.id, {
            content: text,
            status: text ? "ready" : "error",
            error: text ? null : "Transkript ist leer",
          });
          return;
        }

        const page = await fetchPageText({ data: { url } });
        updateNode(record.id, { title: page.title, content: page.text, status: "ready" });
      } catch (error) {
        updateNode(record.id, {
          status: "error",
          error: error instanceof Error ? error.message : "Verarbeitung fehlgeschlagen",
        });
      }
    },
    [createRecord, nextPosition, updateNode],
  );

  const addFiles = useCallback(
    async (files: FileList | File[]) => {
      for (const file of Array.from(files)) {
        const position = nextPosition();
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
    [createRecord, nextPosition, updateNode, user],
  );

  const onConnect = useCallback(
    (connection: Connection) => {
      if (!user || !connection.source || !connection.target) return;
      const id = crypto.randomUUID();
      setEdges((current) => addEdge({ ...connection, id, animated: true }, current));
      void supabase
        .from("edges")
        .insert({
          id,
          board_id: boardId,
          user_id: user.id,
          source_id: connection.source,
          target_id: connection.target,
        } as never)
        .then(({ error }) => {
          if (error) toast.error(error.message);
        });
    },
    [boardId, setEdges, user],
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
            ? { ...n, parentId: frame.id, extent: "parent" as const, position: relative, selected: false }
            : n,
        ),
      );
    }
  }, [nodes, createRecord, updateNode, setNodes]);

  const api = useMemo(
    () => ({ updateNode, deleteNode, collectContext, addNoteFrom }),
    [updateNode, deleteNode, collectContext, addNoteFrom],
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
    return <div className="flex min-h-screen items-center justify-center text-muted-foreground">…</div>;
  }

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
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Input
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                void addUrl(urlInput);
                setUrlInput("");
              }
            }}
            placeholder="YouTube- oder Podcast-Link einfügen"
            className="h-8 w-64 text-sm"
          />
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              void addUrl(urlInput);
              setUrlInput("");
            }}
          >
            Link
          </Button>
          <input
            ref={fileRef}
            type="file"
            multiple
            accept=".pdf,.pptx,.docx,.txt,.md,audio/*"
            className="hidden"
            onChange={(e) => {
              if (e.target.files?.length) void addFiles(e.target.files);
              e.target.value = "";
            }}
          />
          <Button size="sm" variant="secondary" onClick={() => fileRef.current?.click()}>
            Datei
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              const p = nextPosition();
              void createRecord({
                type: "note",
                title: "Notiz",
                content: "",
                position_x: p.x,
                position_y: p.y,
              });
            }}
          >
            Notiz
          </Button>
          <Button
            size="sm"
            onClick={() => {
              const p = nextPosition();
              void createRecord({
                type: "chat",
                title: "Chat",
                position_x: p.x,
                position_y: p.y,
                metadata: { model: "openai/gpt-6-astra" },
              });
            }}
          >
            Chat
          </Button>
          <Button size="sm" variant="outline" onClick={() => void groupSelection()}>
            Gruppieren
          </Button>
        </div>
      </header>

      <div
        className="relative flex-1"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          if (e.dataTransfer.files.length) void addFiles(e.dataTransfer.files);
          else {
            const text = e.dataTransfer.getData("text");
            if (text) void addUrl(text);
          }
        }}
      >
        <BoardContext.Provider value={api}>
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
            onNodeClick={() => undefined}
            fitView={ready}
            minZoom={0.15}
            maxZoom={2.5}
            selectionOnDrag
            panOnScroll
            proOptions={{ hideAttribution: true }}
          >
            <Background variant={BackgroundVariant.Dots} gap={22} size={1.6} color="var(--canvas-dot)" />
            <Controls showInteractive={false} />
            <MiniMap pannable zoomable className="!bg-card" />
          </ReactFlow>
        </BoardContext.Provider>

        {ready && nodes.length === 0 && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <p className="max-w-sm rounded-2xl border border-dashed bg-card/80 px-6 py-5 text-center text-sm text-muted-foreground">
              Füge einen Link ein (Strg+V), ziehe Dateien hierher oder lege oben ein Chat-Modul an.
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
