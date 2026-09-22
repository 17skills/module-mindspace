/**
 * App-Bühne: stellt beliebige Scope-Module eigenständig dar – ohne Canvas.
 * Dieselbe Darstellung nutzt die ausgelieferte App und die Live-Vorschau im Studio.
 */
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { ClientOnly } from "@tanstack/react-router";
import {
  AlignHorizontalJustifyCenter,
  AlignHorizontalJustifyEnd,
  AlignHorizontalJustifyStart,
  AlignVerticalJustifyCenter,
  AlignVerticalJustifyEnd,
  AlignVerticalJustifyStart,
  Grid2X2,
  Grip,
  Magnet,
  MapPin,
  MoveDiagonal2,
  Redo2,
  Undo2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import type { NodeRecord } from "@/components/canvas/board-context";
import { MODULE_TYPE_LABEL } from "@/lib/apps";
import { formatValue, readFormat, valueOfNode } from "@/lib/calc";
import { readFactor } from "@/lib/factor-score";
import { pointsFromSources, readMapConfig } from "@/lib/geo";
import { classOf, evaluate, readIsoRisk } from "@/lib/iso-risk";
import {
  clusterOf,
  euro,
  priorityColor,
  readInspection,
  STATUS_COLOR,
  STATUS_VALUES,
  totalCost,
  type Finding,
} from "@/lib/inspection";
import {
  APP_GRID_COLUMNS,
  APP_GRID_ROW_HEIGHT,
  alignFreeLayout,
  buildFreeLayout,
  type FreeLayoutAlignment,
  type FreeLayoutGuides,
  resolveLayout,
  snapFreeLayout,
  TILE_TYPES,
  WIDE_TYPES,
} from "@/lib/app-layout";
import type { AppGridItem, AppLayout } from "@/lib/zones";

const LeafletMap = lazy(() => import("@/components/canvas/LeafletMap"));

export type ModuleAction = {
  setStatus: (nodeId: string, finding: Finding, status: Finding["status"]) => void;
};

function Card({
  title,
  kind,
  children,
  className = "",
}: {
  title: string;
  kind: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`h-full overflow-auto rounded-xl border border-border/70 bg-card p-4 shadow-[var(--shadow-card)] ${className}`}
    >
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
        <span className="module-eyebrow truncate text-muted-foreground">{title}</span>
        <span className="shrink-0 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          {MODULE_TYPE_LABEL[kind] ?? kind}
        </span>
      </div>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function Value({ node, nodes }: { node: NodeRecord; nodes: NodeRecord[] }) {
  const records = useMemo(
    () => Object.fromEntries(nodes.map((item) => [item.id, item])),
    [nodes],
  );
  const value = valueOfNode(node, records, []);
  const text = formatValue(value, readFormat(node.metadata));
  return (
    <div>
      <p className="font-mono text-3xl">{text}</p>
      {node.content ? (
        <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{node.content}</p>
      ) : null}
    </div>
  );
}

function FactorCard({ node }: { node: NodeRecord }) {
  const factor = readFactor(node);
  return (
    <div className="space-y-2">
      <p className="font-mono text-3xl">{factor.score || "–"}<span className="text-base text-muted-foreground">/10</span></p>
      <ul className="space-y-1.5">
        {factor.params.slice(0, 6).map((param) => (
          <li key={param.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
            <span className="truncate text-xs">{param.label}</span>
            <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
              {param.weight}% · {param.score}
            </span>
          </li>
        ))}
        {factor.params.length === 0 && (
          <li className="text-xs text-muted-foreground">Noch keine Parameter hinterlegt.</li>
        )}
      </ul>
    </div>
  );
}

function RiskCard({ node }: { node: NodeRecord }) {
  const result = evaluate(readIsoRisk(node).fields);
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-baseline gap-3">
        <span className="font-mono text-3xl">{result.index}%</span>
        <span
          className="rounded-full px-2 py-0.5 text-[11px]"
          style={{ background: result.portfolio.color }}
        >
          {result.portfolio.label}
        </span>
      </div>
      <ul className="space-y-1.5">
        {result.fields.map((field) => (
          <li key={field.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
            <span className="truncate text-xs">
              {field.code} · {field.name}
            </span>
            <span
              className="shrink-0 rounded-full px-2 py-0.5 font-mono text-[11px]"
              style={{ background: classOf(field.score).color }}
            >
              {field.score}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function MapCard({ node, nodes }: { node: NodeRecord; nodes: NodeRecord[] }) {
  const config = readMapConfig(node);
  const sources = nodes.filter((item) => item.id !== node.id);
  const points = useMemo(
    () => pointsFromSources(sources.length ? sources : [node], config),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [nodes, node],
  );
  const center: [number, number] = points.length
    ? [points[0]!.lat, points[0]!.lon]
    : config.center;
  const fallback = (
    <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
      Karte lädt …
    </div>
  );
  return (
    <div className="h-full min-h-[320px] w-full overflow-hidden rounded-lg">
      <ClientOnly fallback={fallback}>
        <Suspense fallback={fallback}>
          <LeafletMap
            points={points}
            weather={config.weather}
            center={center}
            zoom={points.length ? 11 : config.zoom}
            selectedId={null}
            onSelect={() => {}}
          />
        </Suspense>
      </ClientOnly>
    </div>
  );
}

function InspectCard({
  node,
  actions,
}: {
  node: NodeRecord;
  actions?: ModuleAction | undefined;
}) {
  const findings = readInspection(node).findings;
  const [filter, setFilter] = useState<"alle" | "offen" | "sofort">("alle");
  const [selected, setSelected] = useState<string | null>(null);
  const open = findings.filter((item) => item.status !== "erledigt");
  const shown = findings
    .filter((item) =>
      filter === "alle" ? true : filter === "offen" ? item.status !== "erledigt" : item.priority <= 3,
    )
    .sort((a, b) => a.priority - b.priority);

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-2 text-center">
        <Stat label="Sofort" value={String(open.filter((f) => f.priority <= 3).length)} />
        <Stat label="Offen" value={String(open.length)} />
        <Stat label="Kosten" value={euro(totalCost(open))} />
      </div>
      <div className="flex gap-1">
        {(["alle", "offen", "sofort"] as const).map((value) => (
          <button
            key={value}
            onClick={() => setFilter(value)}
            className={`rounded-full border px-2 py-0.5 text-[11px] capitalize transition-colors ${
              filter === value
                ? "border-transparent bg-primary text-primary-foreground"
                : "border-border text-muted-foreground hover:bg-accent"
            }`}
          >
            {value}
          </button>
        ))}
      </div>
      <ul className="max-h-[360px] space-y-2 overflow-auto pr-1">
        {shown.map((finding) => (
          <li
            key={finding.id}
            onClick={() => setSelected(selected === finding.id ? null : finding.id)}
            className={`cursor-pointer rounded-lg border p-2 transition-colors ${
              selected === finding.id ? "border-ring bg-accent/40" : "border-border/70"
            }`}
          >
            <div className="flex items-center gap-2">
              {finding.thumb ? (
                <img src={finding.thumb} alt="" className="size-12 shrink-0 rounded-md object-cover" />
              ) : (
                <div className="size-12 shrink-0 rounded-md bg-secondary" />
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{finding.label}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {finding.category} · {euro(finding.cost)} · {clusterOf(finding.priority)?.label}
                </p>
              </div>
              <span
                className="shrink-0 rounded-full px-2 py-0.5 font-mono text-[11px] text-white"
                style={{ background: priorityColor(finding.priority) }}
              >
                {finding.priority}
              </span>
            </div>
            {selected === finding.id && (
              <div className="mt-2 space-y-2">
                <p className="text-xs text-muted-foreground">
                  {finding.finding} → {finding.action}
                </p>
                {finding.lat != null && finding.lon != null && (
                  <p className="flex items-center gap-1 font-mono text-[11px] text-muted-foreground">
                    <MapPin className="size-3" />
                    {finding.lat.toFixed(4)}, {finding.lon.toFixed(4)}
                  </p>
                )}
                {actions && (
                  <div className="flex flex-wrap gap-1">
                    {STATUS_VALUES.map((status) => (
                      <button
                        key={status}
                        onClick={(event) => {
                          event.stopPropagation();
                          actions.setStatus(node.id, finding, status);
                        }}
                        className="rounded-full border px-2 py-0.5 text-[11px] transition-colors hover:bg-accent"
                        style={
                          finding.status === status
                            ? {
                                background: STATUS_COLOR[status],
                                color: "#fff",
                                borderColor: "transparent",
                              }
                            : undefined
                        }
                      >
                        {status}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </li>
        ))}
        {shown.length === 0 && (
          <li className="text-sm text-muted-foreground">Keine Befunde in dieser Ansicht.</li>
        )}
      </ul>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border/70 p-2">
      <p className="module-eyebrow text-muted-foreground">{label}</p>
      <p className="font-mono text-lg">{value}</p>
    </div>
  );
}

function TextCard({ node }: { node: NodeRecord }) {
  const text = (node.content ?? "").trim();
  return text ? (
    <p className="whitespace-pre-wrap text-sm leading-relaxed">{text.slice(0, 2000)}</p>
  ) : (
    <p className="text-sm text-muted-foreground">Dieses Modul hat noch keinen Inhalt.</p>
  );
}

/** Ein Modul in der App-Darstellung. */
export function AppModule({
  node,
  nodes,
  actions,
  className = "",
}: {
  node: NodeRecord;
  nodes: NodeRecord[];
  actions?: ModuleAction | undefined;
  className?: string;
}) {
  const title = node.title?.trim() || MODULE_TYPE_LABEL[node.type] || "Modul";
  if (node.type === "map") {
    return (
      <section
        className={`overflow-hidden rounded-xl border border-border/70 bg-card shadow-[var(--shadow-card)] ${className}`}
      >
        <div className="px-4 pt-3">
          <span className="module-eyebrow text-muted-foreground">{title}</span>
        </div>
        <div className="mt-2 h-[min(60vh,420px)] p-2 pt-0">
          <MapCard node={node} nodes={nodes} />
        </div>
      </section>
    );
  }
  return (
    <Card title={title} kind={node.type} className={className}>
      {TILE_TYPES.has(node.type) ? (
        <Value node={node} nodes={nodes} />
      ) : node.type === "note" ? (
        <FactorCard node={node} />
      ) : node.type === "risk" ? (
        <RiskCard node={node} />
      ) : node.type === "inspect" ? (
        <InspectCard node={node} actions={actions} />
      ) : (
        <TextCard node={node} />
      )}
    </Card>
  );
}

/** Ordnet die gewählten Module nach dem eingestellten Aufbau an. */
export function AppEngine({
  nodes,
  layout,
  actions,
  moduleLayout = [],
  editable = false,
  compactPreview = false,
  onModuleLayoutChange,
}: {
  nodes: NodeRecord[];
  layout: AppLayout;
  actions?: ModuleAction | undefined;
  moduleLayout?: AppGridItem[];
  editable?: boolean;
  compactPreview?: boolean;
  onModuleLayoutChange?: (layout: AppGridItem[]) => void;
}) {
  const mode = resolveLayout(layout, nodes.map((node) => node.type));
  if (!nodes.length) {
    return (
      <main className="flex-1 p-6 text-sm text-muted-foreground">
        Für diese App wurde noch kein Modul gewählt.
      </main>
    );
  }

  const common = { nodes, actions };

  if (mode === "free") {
    return (
      <FreeAppLayout
        nodes={nodes}
        actions={actions}
        saved={moduleLayout}
        editable={editable}
        compact={compactPreview}
        onChange={onModuleLayoutChange}
      />
    );
  }

  if (mode === "feed") {
    return (
      <main className="mx-auto w-full max-w-xl flex-1 space-y-3 p-4">
        {nodes.map((node) => (
          <AppModule key={node.id} node={node} {...common} />
        ))}
      </main>
    );
  }

  if (mode === "report") {
    return (
      <main className="mx-auto w-full max-w-3xl flex-1 space-y-4 p-4">
        {nodes.map((node) => (
          <AppModule key={node.id} node={node} {...common} />
        ))}
      </main>
    );
  }

  if (mode === "dashboard") {
    const tiles = nodes.filter((node) => TILE_TYPES.has(node.type));
    const rest = nodes.filter((node) => !TILE_TYPES.has(node.type));
    return (
      <main className="flex-1 space-y-4 p-4">
        {tiles.length > 0 && (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {tiles.map((node) => (
              <AppModule key={node.id} node={node} {...common} />
            ))}
          </div>
        )}
        {rest.length > 0 && (
          <div className="grid gap-4 lg:grid-cols-2">
            {rest.map((node) => (
              <AppModule key={node.id} node={node} {...common} />
            ))}
          </div>
        )}
      </main>
    );
  }

  // split
  const main = nodes.find((node) => WIDE_TYPES.has(node.type)) ?? nodes[0]!;
  const side = nodes.filter((node) => node.id !== main.id);
  return (
    <main className="grid flex-1 gap-4 p-4 lg:grid-cols-[1.25fr_1fr]">
      <AppModule node={main} {...common} />
      <div className="space-y-4">
        {side.map((node) => (
          <AppModule key={node.id} node={node} {...common} />
        ))}
      </div>
    </main>
  );
}

type Gesture = {
  id: string;
  kind: "move" | "resize";
  startX: number;
  startY: number;
  initial: AppGridItem;
  initialLayout: AppGridItem[];
};

const ALIGNMENTS: { id: FreeLayoutAlignment; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: "left", label: "Links ausrichten", icon: AlignHorizontalJustifyStart },
  { id: "center-x", label: "Horizontal zentrieren", icon: AlignHorizontalJustifyCenter },
  { id: "right", label: "Rechts ausrichten", icon: AlignHorizontalJustifyEnd },
  { id: "top", label: "Oben ausrichten", icon: AlignVerticalJustifyStart },
  { id: "center-y", label: "Vertikal zentrieren", icon: AlignVerticalJustifyCenter },
  { id: "bottom", label: "Unten ausrichten", icon: AlignVerticalJustifyEnd },
];

function FreeAppLayout({
  nodes,
  actions,
  saved,
  editable,
  compact,
  onChange,
}: {
  nodes: NodeRecord[];
  actions?: ModuleAction | undefined;
  saved: AppGridItem[];
  editable: boolean;
  compact: boolean;
  onChange?: ((layout: AppGridItem[]) => void) | undefined;
}) {
  const gridRef = useRef<HTMLElement>(null);
  const [layout, setLayout] = useState(() => buildFreeLayout(nodes, saved));
  const [gesture, setGesture] = useState<Gesture | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [showGrid, setShowGrid] = useState(true);
  const [magnetic, setMagnetic] = useState(true);
  const [guides, setGuides] = useState<FreeLayoutGuides>({});
  const [past, setPast] = useState<AppGridItem[][]>([]);
  const [future, setFuture] = useState<AppGridItem[][]>([]);
  const emittedRef = useRef("");
  const savedKey = JSON.stringify(saved);

  useEffect(() => {
    const next = buildFreeLayout(nodes, saved);
    const nextKey = JSON.stringify(next);
    if (nextKey === emittedRef.current) return;
    setLayout(next);
    setPast([]);
    setFuture([]);
    setSelected((current) => current.filter((id) => nodes.some((node) => node.id === id)));
  }, [nodes, savedKey]);

  const emit = (next: AppGridItem[]) => {
    emittedRef.current = JSON.stringify(next);
    onChange?.(next);
  };

  const commit = (before: AppGridItem[], next: AppGridItem[]) => {
    if (JSON.stringify(before) === JSON.stringify(next)) {
      setLayout(before);
      return;
    }
    setPast((items) => [...items.slice(-49), before]);
    setFuture([]);
    setLayout(next);
    emit(next);
  };

  const undo = () => {
    const previous = past.at(-1);
    if (!previous) return;
    setPast((items) => items.slice(0, -1));
    setFuture((items) => [layout, ...items].slice(0, 50));
    setLayout(previous);
    emit(previous);
  };

  const redo = () => {
    const next = future[0];
    if (!next) return;
    setFuture((items) => items.slice(1));
    setPast((items) => [...items.slice(-49), layout]);
    setLayout(next);
    emit(next);
  };

  useEffect(() => {
    if (!editable || compact) return;
    const keydown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "z") return;
      event.preventDefault();
      if (event.shiftKey) redo();
      else undo();
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [editable, compact, layout, past, future]);

  useEffect(() => {
    if (!gesture) return;
    const place = (event: PointerEvent) => {
      const gridWidth = gridRef.current?.getBoundingClientRect().width ?? 0;
      if (!gridWidth) return { layout: gesture.initialLayout, guides: {} };
      const columnStep = (gridWidth - 32 - 11 * 12) / APP_GRID_COLUMNS + 12;
      const dx = Math.round((event.clientX - gesture.startX) / columnStep);
      const dy = Math.round((event.clientY - gesture.startY) / (APP_GRID_ROW_HEIGHT + 12));
      const patch = gesture.kind === "move"
        ? { col: gesture.initial.col + dx, row: gesture.initial.row + dy }
        : { width: gesture.initial.width + dx, height: gesture.initial.height + dy };
      return snapFreeLayout(gesture.initialLayout, gesture.id, patch, gesture.kind, magnetic);
    };
    const move = (event: PointerEvent) => {
      const preview = place(event);
      setLayout(preview.layout);
      setGuides(preview.guides);
    };
    const finish = (event: PointerEvent) => {
      const result = place(event);
      commit(gesture.initialLayout, result.layout);
      setGuides({});
      setGesture(null);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish, { once: true });
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
    };
  }, [gesture, magnetic]);

  const start = (event: React.PointerEvent, item: AppGridItem, kind: Gesture["kind"]) => {
    event.preventDefault();
    event.stopPropagation();
    if (!selected.includes(item.id)) setSelected([item.id]);
    setGesture({
      id: item.id,
      kind,
      startX: event.clientX,
      startY: event.clientY,
      initial: item,
      initialLayout: layout,
    });
  };

  const select = (event: React.MouseEvent, id: string) => {
    event.stopPropagation();
    if (event.shiftKey || event.metaKey || event.ctrlKey) {
      setSelected((items) => items.includes(id) ? items.filter((item) => item !== id) : [...items, id]);
    } else {
      setSelected([id]);
    }
  };

  const align = (alignment: FreeLayoutAlignment) => {
    const next = alignFreeLayout(layout, selected, alignment);
    commit(layout, next);
  };

  const mobile = compact;
  return (
    <main className="relative flex flex-1 flex-col" data-layout="free">
      {editable && !mobile ? (
        <div className="sticky top-0 z-30 flex flex-wrap items-center gap-1 border-b border-border/70 bg-background/95 px-3 py-2 backdrop-blur">
          <Button size="icon" variant={showGrid ? "secondary" : "ghost"} aria-label="Raster anzeigen" title="Raster anzeigen" onClick={() => setShowGrid((value) => !value)}>
            <Grid2X2 className="size-3.5" />
          </Button>
          <Button size="icon" variant={magnetic ? "secondary" : "ghost"} aria-label="Magnetisches Einrasten" title="Magnetisches Einrasten" onClick={() => setMagnetic((value) => !value)}>
            <Magnet className="size-3.5" />
          </Button>
          <span className="mx-1 h-5 w-px bg-border" />
          <Button size="icon" variant="ghost" disabled={!past.length} aria-label="Rückgängig" title="Rückgängig (⌘Z)" onClick={undo}>
            <Undo2 className="size-3.5" />
          </Button>
          <Button size="icon" variant="ghost" disabled={!future.length} aria-label="Wiederherstellen" title="Wiederherstellen (⌘⇧Z)" onClick={redo}>
            <Redo2 className="size-3.5" />
          </Button>
          <span className="mx-1 h-5 w-px bg-border" />
          {ALIGNMENTS.map(({ id, label, icon: Icon }) => (
            <Button key={id} size="icon" variant="ghost" disabled={selected.length < 2} aria-label={label} title={label} onClick={() => align(id)}>
              <Icon className="size-3.5" />
            </Button>
          ))}
          <span className="ml-auto font-mono text-[10px] text-muted-foreground">
            {selected.length ? `${selected.length} gewählt` : "Module wählen"}
          </span>
        </div>
      ) : null}
      <section
        ref={gridRef}
        data-grid-visible={showGrid && editable && !mobile}
        className={`free-layout-grid relative grid flex-1 grid-cols-12 gap-3 p-4 ${mobile ? "!block space-y-3" : "max-md:!block max-md:space-y-3"}`}
        style={mobile ? undefined : { gridAutoRows: `${APP_GRID_ROW_HEIGHT}px` }}
        onClick={() => setSelected([])}
      >
        {guides.vertical != null ? (
          <span className="pointer-events-none absolute inset-y-0 z-20 w-px bg-ring" style={{ left: `calc(1rem + (100% - 2rem) * ${guides.vertical - 1} / 12)` }} />
        ) : null}
        {guides.horizontal != null ? (
          <span className="pointer-events-none absolute inset-x-0 z-20 h-px bg-ring" style={{ top: `${16 + (guides.horizontal - 1) * (APP_GRID_ROW_HEIGHT + 12)}px` }} />
        ) : null}
      {nodes.map((node) => {
        const item = layout.find((entry) => entry.id === node.id);
        if (!item) return null;
        return (
          <div
            key={node.id}
            data-grid-id={node.id}
            className={`relative min-h-0 ${selected.includes(node.id) ? "ring-2 ring-ring ring-offset-2 ring-offset-background" : ""} ${mobile ? "mb-3" : "max-md:mb-3"}`}
            style={mobile ? undefined : {
              gridColumn: `${item.col} / span ${item.width}`,
              gridRow: `${item.row} / span ${item.height}`,
            }}
            onClick={(event) => select(event, node.id)}
          >
            <AppModule node={node} nodes={nodes} actions={actions} className="h-full" />
            {editable && !mobile ? (
              <>
                <button
                  type="button"
                  aria-label={`${node.title ?? "Modul"} verschieben`}
                  title="Modul verschieben"
                  className="absolute right-9 top-2 z-10 flex size-7 cursor-grab items-center justify-center rounded-md border border-border bg-background shadow-sm active:cursor-grabbing"
                  onPointerDown={(event) => start(event, item, "move")}
                >
                  <Grip className="size-3.5" />
                </button>
                <button
                  type="button"
                  aria-label={`${node.title ?? "Modul"} Größe ändern`}
                  title="Größe ändern"
                  className="absolute bottom-2 right-2 z-10 flex size-7 cursor-nwse-resize items-center justify-center rounded-md border border-border bg-background shadow-sm"
                  onPointerDown={(event) => start(event, item, "resize")}
                >
                  <MoveDiagonal2 className="size-3.5" />
                </button>
              </>
            ) : null}
          </div>
        );
      })}
      </section>
    </main>
  );
}
