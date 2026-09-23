import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  Background,
  BackgroundVariant,
  Controls,
  MarkerType,
  ReactFlow,
  ReactFlowProvider,
  type Edge,
  type Node,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Eye } from "lucide-react";
import {
  BoardContext,
  type BoardApi,
  type NodeRecord,
} from "@/components/canvas/board-context";
import {
  CalcNode,
  ChatNode,
  ContentNode,
  DataNode,
  FrameNode,
  GaugeNode,
  LabeledEdge,
  MetricNode,
  NoteNode,
  ShapeNode,
  SheetNode,
  ApiNode,
  McpNode,
  McpHubNode,
  DecisionNode,
  SignalNode,
  QuotesNode,
  InspectNode,
  MapNode,
  RiskNode,
  TextNode,
  ZoneNode,
} from "@/components/canvas/nodes";
import { getSharedBoard } from "@/lib/share.functions";

export const Route = createFileRoute("/share/$token")({
  head: () => ({
    meta: [
      { title: "Geteilter Scope – scopebuilder" },
      {
        name: "description",
        content:
          "Nur-Lese-Ansicht eines geteilten scopebuilder-Scopes mit Videos, Dokumenten und Notizen.",
      },
      { property: "og:title", content: "Geteilter Scope – scopebuilder" },
      {
        property: "og:description",
        content: "Einen geteilten Scope ansehen – ohne Anmeldung, nur lesen.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: () => (
    <ReactFlowProvider>
      <SharedBoardPage />
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
  calc: CalcNode,
  metric: MetricNode,
  gauge: GaugeNode,
  sheet: SheetNode,
  api: ApiNode,
  mcp: McpNode,
  mcphub: McpHubNode,
  decision: DecisionNode,
  signal: SignalNode,
  quotes: QuotesNode,
  map: MapNode,
  risk: RiskNode,
  inspect: InspectNode,
};

const edgeTypes = { labeled: LabeledEdge };

const DATA_TYPES = new Set(["table", "list", "chart"]);
const SIZE: Record<string, { width: number; height: number }> = {
  note: { width: 260, height: 200 },
  chat: { width: 380, height: 420 },
  default: { width: 320, height: 300 },
};

function toFlowNode(record: NodeRecord): Node {
  const size = SIZE[record.type] ?? SIZE["default"]!;
  const kind =
    record.type === "note" ||
    record.type === "chat" ||
    record.type === "frame" ||
    record.type === "zone" ||
    record.type === "shape" ||
    record.type === "calc" ||
    record.type === "metric" ||
    record.type === "gauge" ||
    record.type === "sheet" ||
    record.type === "api" ||
    record.type === "decision" ||
    record.type === "signal" ||
    record.type === "map" ||
    record.type === "risk" ||
    record.type === "inspect" ||
    record.type === "quotes" ||
    record.type === "text"
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
    draggable: false,
    connectable: false,
    deletable: false,
    ...(record.parent_id ? { parentId: record.parent_id, extent: "parent" as const } : {}),
    ...(kind === "frame" ? { zIndex: -1 } : {}),
    ...(kind === "zone" ? { zIndex: record.parent_id ? -2 : -3 } : {}),
  };
}

function layer(record: NodeRecord) {
  if (record.type === "zone") return record.parent_id ? -2 : -3;
  return record.type === "frame" ? -1 : 0;
}

function SharedBoardPage() {
  const { token } = Route.useParams();
  const [title, setTitle] = useState("");
  const [records, setRecords] = useState<NodeRecord[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(
    async (password?: string) => {
      setLoading(true);
      setError(null);
      try {
        const result = await getSharedBoard({ data: { token, ...(password ? { password } : {}) } });
        if (result.locked) {
          setLocked(true);
          return;
        }
        setLocked(false);
        setTitle(result.board?.title ?? "");
        setRecords(result.nodes as unknown as NodeRecord[]);
        setEdges(
          result.edges.map((edge) => ({
            id: edge.id as string,
            source: edge.source_id as string,
            target: edge.target_id as string,
            type: "labeled",
            label: (edge.label as string | null) ?? undefined,
          })),
        );
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Scope nicht verfügbar");
      } finally {
        setLoading(false);
      }
    },
    [token],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const nodes = useMemo(
    () => [...records].sort((a, b) => layer(a) - layer(b)).map(toFlowNode),
    [records],
  );

  const api = useMemo<BoardApi>(() => {
    const noop = () => {};
    return {
      sourcesFor: () => [],
      createZone: async () => null,
      updateNode: noop,
      updateEdge: noop,
      deleteEdge: noop,
      runAgent: noop,
      agentStale: () => false,
      calcForEdge: noop,
      runApi: noop,
      runMcp: noop,
      spawnMcpTool: noop,
      runDecide: noop,
      deleteNode: noop,
      collectContext: () => "",
      contextReport: () => ({ used: [], excluded: [] }),
      addNoteFrom: noop,
      extractStructure: noop,
      openInspector: noop,
      applyStructure: noop,
      createStructure: async () => {},
      zones: () => records.filter((record) => record.type === "zone"),
      zoneOf: () => null,
      allNodes: () => records,
      focusNode: noop,
      resizeZone: noop,
    };
  }, [records]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-muted-foreground">…</div>
    );
  }

  if (error) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-2 px-6 text-center">
        <h1 className="font-display text-xl font-semibold text-brand-navy">Kein Zugriff</h1>
        <p className="text-muted-foreground">{error}</p>
      </div>
    );
  }

  return (
    <BoardContext.Provider value={api}>
      <div className="flex h-screen flex-col bg-background">
        <header className="flex h-14 items-center gap-3 border-b border-border/70 bg-card/90 px-4 backdrop-blur">
          <span className="font-display text-base font-semibold tracking-tight text-brand-navy">
            {title || "Geteilter Scope"}
          </span>
          <span className="flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground">
            <Eye className="size-3.5" />
            Nur lesen
          </span>
        </header>
        <div className="relative flex-1">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            defaultEdgeOptions={{
              markerEnd: {
                type: MarkerType.ArrowClosed,
                width: 14,
                height: 14,
                color: "var(--edge)",
              },
            }}
            nodesDraggable={false}
            nodesConnectable={false}
            elementsSelectable={false}
            deleteKeyCode={null}
            fitView
          >
            <Background variant={BackgroundVariant.Dots} gap={22} size={1} />
            <Controls showInteractive={false} />
          </ReactFlow>
        </div>
      </div>
    </BoardContext.Provider>
  );
}
