/**
 * App-Bühne: stellt beliebige Scope-Module eigenständig dar – ohne Canvas.
 * Dieselbe Darstellung nutzt die ausgelieferte App und die Live-Vorschau im Studio.
 */
import { lazy, Suspense, useMemo, useState } from "react";
import { ClientOnly } from "@tanstack/react-router";
import { MapPin } from "lucide-react";
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
import { resolveLayout, TILE_TYPES, WIDE_TYPES } from "@/lib/app-layout";
import type { AppLayout } from "@/lib/zones";

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
      className={`rounded-xl border border-border/70 bg-card p-4 shadow-[var(--shadow-card)] ${className}`}
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
}: {
  nodes: NodeRecord[];
  layout: AppLayout;
  actions?: ModuleAction | undefined;
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
