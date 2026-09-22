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
import { Download } from "lucide-react";
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
  DecisionNode,
  SignalNode,
  QuotesNode,
  InspectNode,
  MapNode,
  RiskNode,
  TextNode,
  ZoneNode,
} from "@/components/canvas/nodes";
import { Button } from "@/components/ui/button";
import { getEmbedZone } from "@/lib/embed.functions";
import { readAppBranding, readAppLayout, type AppLayoutEntry } from "@/lib/zones";

export const Route = createFileRoute("/embed/zone/$zoneId")({
  head: () => ({
    meta: [
      { title: "Feld-Ansicht – Canvas Spark" },
      {
        name: "description",
        content:
          "Eingebettete Ansicht eines Hintergrundfelds mit seinen Modulen – für Microsoft Teams oder andere Portale.",
      },
      { property: "og:title", content: "Feld-Ansicht – Canvas Spark" },
      {
        property: "og:description",
        content: "Ein Modulbündel als eigenständige Mini-Anwendung ansehen.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: () => (
    <ReactFlowProvider>
      <EmbedZonePage />
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
  decision: DecisionNode,
  signal: SignalNode,
  quotes: QuotesNode,
  map: MapNode,
  risk: RiskNode,
  inspect: InspectNode,
};

const edgeTypes = { labeled: LabeledEdge };
const DATA_TYPES = new Set(["table", "list", "chart"]);

function toFlowNode(record: NodeRecord): Node {
  const kind =
    record.type in nodeTypes && record.type !== "content"
      ? record.type
      : DATA_TYPES.has(record.type)
        ? "data"
        : "content";
  return {
    id: record.id,
    type: kind,
    position: { x: record.position_x, y: record.position_y },
    width: record.width ?? 320,
    height: record.height ?? 300,
    data: { record },
    draggable: false,
    connectable: false,
    deletable: false,
    ...(kind === "frame" ? { zIndex: -1 } : {}),
  };
}

function teamsManifest(zoneTitle: string, zoneId: string, url: string) {
  return {
    $schema: "https://developer.microsoft.com/en-us/json-schemas/teams/v1.16/MicrosoftTeams.schema.json",
    manifestVersion: "1.16",
    version: "1.0.0",
    id: zoneId,
    packageName: `dev.lovable.canvas.${zoneId.slice(0, 8)}`,
    developer: {
      name: "Canvas Spark",
      websiteUrl: new URL(url).origin,
      privacyUrl: `${new URL(url).origin}/`,
      termsOfUseUrl: `${new URL(url).origin}/`,
    },
    name: { short: zoneTitle.slice(0, 30) || "Feld", full: `Canvas Spark – ${zoneTitle}` },
    description: {
      short: `Modulbündel „${zoneTitle}“`.slice(0, 80),
      full: `Eingebettete Ansicht des Felds „${zoneTitle}“ aus Canvas Spark mit allen zugeordneten Modulen.`,
    },
    icons: { color: "color.png", outline: "outline.png" },
    accentColor: "#1C2321",
    staticTabs: [
      {
        entityId: `zone-${zoneId.slice(0, 8)}`,
        name: zoneTitle.slice(0, 16) || "Feld",
        contentUrl: url,
        websiteUrl: url,
        scopes: ["personal"],
      },
    ],
    configurableTabs: [
      {
        configurationUrl: url,
        canUpdateConfiguration: false,
        scopes: ["team", "groupChat"],
      },
    ],
    permissions: ["identity"],
    validDomains: [new URL(url).hostname],
  };
}

function EmbedZonePage() {
  const { zoneId } = Route.useParams();
  const [title, setTitle] = useState("");
  const [records, setRecords] = useState<NodeRecord[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [zoneMeta, setZoneMeta] = useState<Record<string, unknown>>({});
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    void getEmbedZone({ data: { zoneId } })
      .then((result) => {
        if (!active) return;
        setTitle(result.zone.title);
        setRecords(result.nodes as unknown as NodeRecord[]);
        setZoneMeta((result.zone.metadata ?? {}) as Record<string, unknown>);
        setEdges(
          result.edges.map((edge) => ({
            id: String(edge["id"]),
            source: String(edge["source_id"]),
            target: String(edge["target_id"]),
            type: "labeled",
            label: edge["label"] ? String(edge["label"]) : undefined,
          })),
        );
      })
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : "Feld nicht verfügbar"),
      )
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [zoneId]);

  // Gestaltete App-Ansicht: Reihenfolge, Sichtbarkeit und Breite pro Modul.
  const layoutById = useMemo(() => {
    const layout = readAppLayout({ metadata: zoneMeta } as unknown as NodeRecord);
    if (!layout) return null;
    const visible = layout.filter((entry) => !entry.hidden);
    return visible.length ? new Map(visible.map((entry) => [entry.id, entry])) : null;
  }, [zoneMeta]);
  const branding = useMemo(
    () => readAppBranding({ metadata: zoneMeta } as unknown as NodeRecord),
    [zoneMeta],
  );
  const appTitle = branding.title || title || "Feld";

  const nodes = useMemo(() => {
    if (!layoutById) return records.map(toFlowNode);
    const byId = new Map(records.map((record) => [record.id, record]));
    const out: Node[] = [];
    let y = 0;
    for (const [id, entry] of layoutById as Map<string, AppLayoutEntry>) {
      const record = byId.get(id);
      if (!record) continue;
      const height = record.height ?? 300;
      out.push({
        ...toFlowNode(record),
        position: { x: 0, y },
        width: entry.view === "compact" ? 380 : 780,
      });
      y += height + 24;
    }
    return out;
  }, [records, layoutById]);

  const visibleEdges = useMemo(
    () =>
      layoutById
        ? edges.filter((edge) => layoutById.has(edge.source) && layoutById.has(edge.target))
        : edges,
    [edges, layoutById],
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
      runDecide: noop,
      deleteNode: noop,
      collectContext: () => "",
      contextReport: () => ({ used: [], excluded: [] }),
      addNoteFrom: noop,
      extractStructure: noop,
      openInspector: noop,
      applyStructure: noop,
      createStructure: async () => {},
      zones: () => [],
      zoneOf: () => null,
      allNodes: () => records,
      focusNode: noop,
      resizeZone: noop,
    };
  }, [records]);

  const downloadManifest = () => {
    const url = window.location.href.split("?")[0]!;
    const blob = new Blob([JSON.stringify(teamsManifest(appTitle, zoneId, url), null, 2)], {
      type: "application/json",
    });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "manifest.json";
    link.click();
    URL.revokeObjectURL(link.href);
  };

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
      <div className={`app-shell app-accent-${branding.accent} app-background-${branding.background} flex h-screen flex-col`}>
        <header className="app-header flex min-h-16 items-center justify-between gap-3 border-b px-5 py-2.5">
          <div className="flex min-w-0 items-center gap-3">
            {branding.logo ? (
              <img src={branding.logo} alt="" className="app-brand-logo shrink-0 rounded-md bg-card object-contain p-1" style={{ width: branding.logoSize, height: branding.logoSize }} />
            ) : (
              <div className="app-logo-mark size-3 shrink-0 rounded-sm" aria-hidden />
            )}
            <div className="min-w-0">
              <span className="module-eyebrow block text-muted-foreground">MCP · Teams App</span>
              <span className="block truncate font-display text-base font-semibold text-foreground">
                {appTitle}
              </span>
            </div>
            <span className="text-xs text-muted-foreground">
              {layoutById ? layoutById.size : records.length} Module
            </span>
          </div>
          <Button variant="ghost" size="sm" onClick={downloadManifest} className="gap-1.5">
            <Download className="size-3.5" />
            Teams-Paket
          </Button>
        </header>
        <div className="relative flex-1">
          <ReactFlow
            nodes={nodes}
            edges={visibleEdges}
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
            {branding.background !== "paper" && (
              <Background
                variant={branding.background === "grid" ? BackgroundVariant.Lines : BackgroundVariant.Dots}
                gap={branding.background === "grid" ? 28 : 22}
                size={1}
                color="var(--app-grid)"
              />
            )}
            <Controls showInteractive={false} />
          </ReactFlow>
        </div>
      </div>
    </BoardContext.Provider>
  );
}
