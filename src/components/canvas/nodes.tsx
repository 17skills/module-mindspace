import { lazy, memo, Suspense, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { ClientOnly } from "@tanstack/react-router";
import {
  RISK_LABEL,
  mapText,
  maxRisk,
  pointsFromSources,
  readMapConfig,
  readRiskConfig,
  riskColor,
  riskEntries,
  riskText,
  type RiskEntry,
} from "@/lib/geo";
import { BookOpen, Calculator, Globe, Lock, Plus, RefreshCw, RotateCw, Scale, ShieldOff, Sparkles, Trash2 } from "lucide-react";
import {
  BaseEdge,
  EdgeLabelRenderer,
  Handle,
  NodeResizer,
  Position,
  getBezierPath,
  useEdges,
  useStore,
  type EdgeProps,
  type NodeProps,
} from "@xyflow/react";
import { calcInputs, evalFormula, formatValue, readFormat, sheetOutputRow, sheetRows, sheetValues } from "@/lib/calc";
import { readAgent } from "@/lib/zones";
import { runApiModule } from "@/lib/api-module.functions";
import {
  QUOTE_COLORS,
  chartRows,
  evaluateMarks,
  formatPrice,
  hitRate,
  latestPrice,
  latestStamp,
  readHoldings,
  readMode,
  readQuotes,
  totalValue,
  type QuoteMark,
} from "@/lib/quotes";

import {
  answerLabel,
  apiPreview,
  apiValue,
  pickPath,
  readAnswers,
  readApi,
  readQuestions,
  type DecisionQuestion,
} from "@/lib/api-module";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { toast } from "sonner";
import { chartSeries, readStructure } from "@/lib/structure";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Tooltip as UiTooltip,
  TooltipContent as UiTooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ZONE_WHITE } from "@/lib/templates";
import { isProfileLink } from "@/lib/profiles";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { NODE_ACCENT, NODE_LABEL, useBoard, type ContextReport, type NodeRecord } from "./board-context";

/** Shows exactly which modules feed this chat — and which are excluded. */
function ContextBar({
  report,
  onFocus,
}: {
  report: ContextReport;
  onFocus: (id: string) => void;
}) {
  const total = report.used.length + report.excluded.length;
  return (
    <div className="flex items-center border-b px-3 py-1">
      <Popover>
        <UiTooltip>
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>
              <button className="nodrag flex items-center gap-1.5 text-[10px] text-muted-foreground transition-colors hover:text-foreground">
                <BookOpen className="size-3" />
                {total === 0
                  ? "Kein Kontext verbunden"
                  : `Kontext: ${report.used.length} ${report.used.length === 1 ? "Inhalt" : "Inhalte"}`}
                {report.excluded.length > 0 && ` · ${report.excluded.length} ausgenommen`}
              </button>
            </PopoverTrigger>
          </TooltipTrigger>
          <UiTooltipContent>Anzeigen, welche Inhalte an den Chat übertragen werden</UiTooltipContent>
        </UiTooltip>
        <PopoverContent align="start" className="nodrag nowheel w-72 p-0 text-xs">
          <p className="border-b px-3 py-2 font-medium">Übertragener Kontext</p>
          <div className="max-h-64 overflow-auto p-1.5">
            {report.used.length === 0 && report.excluded.length === 0 && (
              <p className="px-1.5 py-2 text-muted-foreground">
                Verbinde Module mit diesem Chat, damit ihr Inhalt als Kontext übertragen wird.
              </p>
            )}
            {report.used.map((item) => (
              <button
                key={item.id}
                onClick={() => onFocus(item.id)}
                className="flex w-full items-center justify-between gap-2 rounded-md px-1.5 py-1.5 text-left transition-colors hover:bg-accent"
              >
                <span className="min-w-0 flex-1 truncate">{item.title}</span>
                <span className="shrink-0 text-muted-foreground">
                  {NODE_LABEL[item.type] ?? item.type} · {Math.round(item.chars / 1000)}k Zeichen
                </span>
              </button>
            ))}
            {report.excluded.length > 0 && (
              <>
                <p className="px-1.5 pb-1 pt-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  Nicht übertragen
                </p>
                {report.excluded.map((item) => (
                  <button
                    key={item.id}
                    onClick={() => onFocus(item.id)}
                    className="flex w-full items-center justify-between gap-2 rounded-md px-1.5 py-1.5 text-left text-muted-foreground transition-colors hover:bg-accent"
                  >
                    <span className="min-w-0 flex-1 truncate">{item.title}</span>
                    <span className="shrink-0">{item.reason}</span>
                  </button>
                ))}
              </>
            )}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}

const MODELS = [
  { id: "openai/gpt-6-astra", label: "GPT-6 Astra" },
  { id: "openai/gpt-5.6-terra", label: "GPT-5.6 Terra" },
  { id: "google/gemini-3.8-flash", label: "Gemini 3.8 Flash" },
];

const QUICK_PROMPTS = [
  { label: "Zusammenfassung", text: "Fasse alle verbundenen Inhalte strukturiert zusammen." },
  {
    label: "LinkedIn-Outline",
    text: "Erstelle aus den Inhalten eine Outline für einen LinkedIn-Post: Hook, 3 Kernpunkte, Call-to-Action.",
  },
  {
    label: "LinkedIn-Post",
    text: "Schreibe aus den Inhalten einen fertigen LinkedIn-Post (max. 1300 Zeichen, klarer Hook, kurze Absätze).",
  },
];

const TYPE_GLYPH: Record<string, string> = {
  youtube: "▶",
  podcast: "🎧",
  audio: "🎧",
  document: "📄",
  link: "🔗",
  note: "✎",
  chat: "💬",
  table: "▦",
  list: "≡",
  chart: "📊",
};

type Data = { record: NodeRecord };

function Shell({
  type,
  children,
  selected,
  locked,
  minWidth = 240,
  minHeight = 160,
}: {
  type: string;
  children: React.ReactNode;
  selected?: boolean;
  locked?: boolean;
  minWidth?: number;
  minHeight?: number;
}) {
  return (
    <>
      <NodeResizer
        minWidth={minWidth}
        minHeight={minHeight}
        isVisible={Boolean(selected)}
        color="var(--primary)"
      />
      {!locked && <Handle type="target" position={Position.Left} />}
      <div
        className="flex h-full w-full flex-col overflow-hidden rounded-2xl border bg-card shadow-[var(--shadow-card)]"
        style={{ borderTop: `3px solid ${NODE_ACCENT[type] ?? "var(--primary)"}` }}
      >
        {children}
      </div>
      {!locked && <Handle type="source" position={Position.Right} />}
    </>
  );
}

function Header({ record }: { record: NodeRecord }) {
  const { deleteNode, zoneOf, openInspector } = useBoard();
  const zone = zoneOf(record.id);
  return (
    <div className="border-b px-3 py-2">
      <div className="flex items-start gap-2">
        <span
          className="mt-0.5 rounded-md px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-white"
          style={{ background: NODE_ACCENT[record.type] ?? "var(--primary)" }}
        >
          {NODE_LABEL[record.type] ?? record.type}
        </span>
        <span className="line-clamp-2 flex-1 text-sm font-medium leading-tight">
          {record.title || "Ohne Titel"}
        </span>
        <UiTooltip>
          <TooltipTrigger asChild>
            <button
              className="nodrag flex size-6 items-center justify-center rounded-full text-xs text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
              onClick={() => deleteNode(record.id)}
              aria-label="Modul löschen"
            >
              ✕
            </button>
          </TooltipTrigger>
          <UiTooltipContent>Modul löschen</UiTooltipContent>
        </UiTooltip>
      </div>
      {zone && (
        <UiTooltip>
          <TooltipTrigger asChild>
            <button
              className="nodrag mt-1.5 flex items-center gap-1.5 text-[10px] text-muted-foreground hover:text-foreground"
              onClick={() => openInspector(record.id, "assign")}
            >
              <span
                className="h-2 w-2 rounded-full"
                style={{ background: zone.color ?? "var(--primary)" }}
              />
              {zone.title} · {zone.role}
            </button>
          </TooltipTrigger>
          <UiTooltipContent>Zuordnung bearbeiten</UiTooltipContent>
        </UiTooltip>
      )}
      {isProfileLink(record) && (
        <UiTooltip>
          <TooltipTrigger asChild>
            <span className="nodrag mt-1.5 inline-flex cursor-default items-center gap-1 rounded-full border border-border/70 px-1.5 py-0.5 text-[10px] text-muted-foreground">
              <ShieldOff className="size-3" />
              Kontextfrei
            </span>
          </TooltipTrigger>
          <UiTooltipContent>
            Profil-Link: Der Inhalt wird nicht ausgelesen und nie an den Chat übertragen.
          </UiTooltipContent>
        </UiTooltip>
      )}
    </div>
  );
}

/** Preview image or a coloured fallback tile so every card stays recognisable. */
function Preview({ record }: { record: NodeRecord }) {
  const thumbnail = (record.metadata?.["thumbnail"] as string | undefined) ?? null;
  const accent = NODE_ACCENT[record.type] ?? "var(--primary)";

  if (thumbnail) {
    return (
      <img
        src={thumbnail}
        alt=""
        className="h-28 w-full shrink-0 bg-secondary object-cover"
        draggable={false}
      />
    );
  }

  return (
    <div
      className="flex h-28 w-full shrink-0 items-center gap-3 px-4"
      style={{ background: `color-mix(in oklab, ${accent} 14%, transparent)` }}
    >
      <span
        className="flex h-12 w-12 items-center justify-center rounded-xl text-xl text-white"
        style={{ background: accent }}
      >
        {TYPE_GLYPH[record.type] ?? "◆"}
      </span>
      <span className="line-clamp-3 text-xs text-muted-foreground">
        {record.content?.slice(0, 160) || NODE_LABEL[record.type] || record.type}
      </span>
    </div>
  );
}

export const ContentNode = memo(function ContentNode({ data, selected }: NodeProps) {
  const record = (data as unknown as Data).record;
  const { extractStructure, openInspector } = useBoard();

  return (
    <Shell type={record.type} selected={selected} locked={Boolean(record.parent_id)}>
      <Header record={record} />
      <Preview record={record} />
      <div className="nowheel flex-1 overflow-auto px-3 py-2 text-xs leading-relaxed text-muted-foreground">
        {record.status === "processing" && (
          <p className="animate-pulse text-foreground">Inhalt wird verarbeitet …</p>
        )}
        {record.status === "error" && <p className="text-destructive">{record.error}</p>}
        {record.status === "ready" && (
          <p className="whitespace-pre-wrap">
            {record.content?.slice(0, 4000) ||
              (record.metadata?.["subtitle"] as string | undefined) ||
              "Kein Text gefunden."}
          </p>
        )}
      </div>
      <div className="flex items-center justify-between gap-2 border-t px-3 py-1.5 text-[11px] text-muted-foreground">
        <span>{record.content ? `${record.content.length.toLocaleString("de-DE")} Zeichen` : "—"}</span>
        <div className="flex items-center gap-2">
          <button
            className="nodrag hover:text-foreground hover:underline"
            onClick={() => openInspector(record.id, "source")}
          >
            Kontextfenster
          </button>
          {record.content && (
            <button
              className="nodrag hover:text-foreground hover:underline"
              onClick={() => extractStructure(record.id)}
            >
              Daten herauslösen
            </button>
          )}
          {record.source_url && (
            <a
              className="nodrag hover:text-foreground hover:underline"
              href={record.source_url}
              target="_blank"
              rel="noreferrer"
            >
              Quelle
            </a>
          )}
        </div>
      </div>
    </Shell>
  );
});

export const NoteNode = memo(function NoteNode({ data, selected }: NodeProps) {
  const record = (data as unknown as Data).record;
  const { updateNode } = useBoard();
  const [text, setText] = useState(record.content ?? "");

  useEffect(() => setText(record.content ?? ""), [record.content]);

  return (
    <Shell type="note" selected={selected} locked={Boolean(record.parent_id)}>
      <Header record={record} />
      <Textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => text !== record.content && updateNode(record.id, { content: text })}
        placeholder="Notiz schreiben …"
        className="nodrag nowheel h-full flex-1 resize-none rounded-none border-0 bg-transparent text-xs focus-visible:ring-0"
      />
    </Shell>
  );
});

export const FrameNode = memo(function FrameNode({ data, selected }: NodeProps) {
  const record = (data as unknown as Data).record;
  const { updateNode, deleteNode } = useBoard();
  return (
    <>
      <NodeResizer
        minWidth={320}
        minHeight={240}
        isVisible={Boolean(selected)}
        color="var(--primary)"
      />
      <Handle type="target" position={Position.Left} />
      <div className="h-full w-full rounded-3xl border-2 border-dashed bg-[color-mix(in_oklab,var(--frame)_10%,transparent)]">
        <div className="flex items-center gap-2 px-4 py-2">
          <input
            defaultValue={record.title ?? "Gruppe"}
            onBlur={(e) => updateNode(record.id, { title: e.target.value })}
            className="nodrag w-full bg-transparent font-display text-sm font-semibold outline-none"
          />
          <button
            className="nodrag text-xs text-muted-foreground hover:text-destructive"
            onClick={() => deleteNode(record.id)}
          >
            ✕
          </button>
        </div>
      </div>
      <Handle type="source" position={Position.Right} />
    </>
  );
});

export interface ZoneColor {
  name: string;
  value: string;
}

export const ZONE_COLORS: readonly ZoneColor[] = [
  { name: "Weiß", value: ZONE_WHITE },
  { name: "Salbei", value: "var(--frame)" },
  { name: "Rot", value: "var(--video)" },
  { name: "Violett", value: "var(--audio)" },
  { name: "Blau", value: "var(--doc)" },
  { name: "Amber", value: "var(--note)" },
  { name: "Petrol", value: "var(--chat)" },
] as const;

export const ZoneNode = memo(function ZoneNode({ data, selected }: NodeProps) {
  const record = (data as unknown as Data).record;
  const { updateNode, resizeZone, runAgent, agentStale, openInspector } = useBoard();
  const color = record.color ?? ZONE_WHITE;
  const meta = (record.metadata ?? {}) as Record<string, unknown>;
  const isGroup = meta["templateGroup"] === true;
  const locked = meta["locked"] === true;
  const agent = readAgent(record);
  const running = meta["agentRunning"] === true;
  const stale = agent ? agentStale(record.id) : false;
  return (
    <>
      <NodeResizer
        minWidth={160}
        minHeight={120}
        isVisible={Boolean(selected) && !locked}
        color="var(--primary)"
        onResizeEnd={(_, params) => resizeZone(record.id, params.width, params.height)}
      />
      <Handle type="target" position={Position.Left} className="!size-3" />
      <Handle type="target" position={Position.Top} className="!size-3" />
      <Handle type="source" position={Position.Right} className="!size-3" />
      <Handle type="source" position={Position.Bottom} className="!size-3" />
      <div
        className={`relative h-full w-full rounded-2xl border${isGroup ? " border-dashed" : ""}`}
        style={{
          background: isGroup
            ? "transparent"
            : color === ZONE_WHITE
              ? "var(--card)"
              : `color-mix(in oklab, ${color} 8%, transparent)`,
          borderColor:
            color === ZONE_WHITE
              ? "var(--border)"
              : `color-mix(in oklab, ${color} 35%, transparent)`,
        }}
      >
        <input
          defaultValue={record.title ?? "Feld"}
          readOnly={locked}
          onBlur={(e) => updateNode(record.id, { title: e.target.value })}
          className="nodrag w-full bg-transparent px-4 py-2.5 pr-9 font-display text-sm font-semibold tracking-wide text-muted-foreground uppercase outline-none read-only:cursor-default"
        />
        {locked && (
          <Lock className="pointer-events-none absolute top-3.5 right-3.5 size-3.5 text-muted-foreground/70" />
        )}
        {agent && (
          <div className="nodrag absolute inset-x-2 bottom-2 rounded-xl border border-border/70 bg-card/95 px-3 py-2 shadow-[var(--shadow-card)]">
            <div className="flex items-center gap-2">
              <Sparkles className="size-3.5 shrink-0 text-primary" />
              <span className="min-w-0 flex-1 truncate font-display text-base font-semibold tracking-tight">
                {running
                  ? "Analysiert …"
                  : agent.result
                    ? `${agent.result}${agent.unit ? ` ${agent.unit}` : ""}`
                    : "Noch kein Ergebnis"}
              </span>
              {stale && !running && (
                <span className="shrink-0 rounded-full bg-destructive/10 px-2 py-0.5 text-[10px] text-destructive">
                  veraltet
                </span>
              )}
              <UiTooltip>
                <TooltipTrigger asChild>
                  <button
                    aria-label="Feld neu analysieren"
                    disabled={running}
                    className="shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground disabled:opacity-40"
                    onClick={() => runAgent(record.id)}
                  >
                    <RefreshCw className={`size-3.5${running ? " animate-spin" : ""}`} />
                  </button>
                </TooltipTrigger>
                <UiTooltipContent>Neu analysieren</UiTooltipContent>
              </UiTooltip>
            </div>
            {agent.reason && (
              <details className="mt-1">
                <summary className="cursor-pointer text-[11px] text-muted-foreground">
                  Begründung
                </summary>
                <p className="mt-1 max-h-24 overflow-auto text-[11px] leading-snug text-muted-foreground">
                  {agent.reason}
                </p>
              </details>
            )}
            <button
              className="mt-1 text-[10px] text-muted-foreground hover:underline"
              onClick={() => openInspector(record.id, "agent")}
            >
              {agent.at
                ? `Zuletzt: ${new Date(agent.at).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })} · Auftrag bearbeiten`
                : "Auftrag bearbeiten"}
            </button>
          </div>
        )}
      </div>
    </>
  );
});

type TableData = { columns: string[]; rows: string[][]; chartType: string | undefined };

function tableData(record: NodeRecord): TableData {
  const meta = (record.metadata ?? {}) as Record<string, unknown>;
  const columns = Array.isArray(meta["columns"]) ? (meta["columns"] as string[]) : [];
  const rows = Array.isArray(meta["rows"]) ? (meta["rows"] as string[][]) : [];
  return { columns, rows, chartType: meta["chartType"] as string | undefined };
}

const CHART_COLORS = ["var(--primary)", "var(--video)", "var(--audio)", "var(--doc)", "var(--note)"];

export const DataNode = memo(function DataNode({ data, selected }: NodeProps) {
  const record = (data as unknown as Data).record;
  const { updateNode, openInspector } = useBoard();
  const { columns, rows, chartType } = tableData(record);
  const type = record.type;

  const chartRows = useMemo(() => chartSeries(readStructure(record)), [record]);

  return (
    <Shell type={type} selected={selected} locked={Boolean(record.parent_id)} minHeight={200}>
      <Header record={record} />
      <div className="flex items-center justify-end gap-2 border-b px-3 py-1 text-[11px] text-muted-foreground">
        <button
          className="nodrag hover:text-foreground hover:underline"
          onClick={() => openInspector(record.id, "data")}
        >
          Bearbeiten
        </button>
        <button
          className="nodrag hover:text-foreground hover:underline"
          onClick={() => openInspector(record.id, "refresh")}
        >
          Aktualisieren
        </button>
      </div>

      {type === "chart" && (
        <>
          <div className="flex gap-1 border-b px-3 py-1.5">
            {(["bar", "line", "pie"] as const).map((option) => (
              <button
                key={option}
                className={`nodrag rounded-full border px-2 py-0.5 text-[10px] ${
                  (chartType ?? "bar") === option
                    ? "bg-secondary text-foreground"
                    : "text-muted-foreground hover:bg-secondary"
                }`}
                onClick={() =>
                  updateNode(record.id, {
                    metadata: { ...(record.metadata ?? {}), chartType: option },
                  })
                }
              >
                {option === "bar" ? "Balken" : option === "line" ? "Linie" : "Kreis"}
              </button>
            ))}
          </div>
          <div className="nowheel min-h-0 flex-1 p-2">
            <ResponsiveContainer width="100%" height="100%">
              {(chartType ?? "bar") === "pie" ? (
                <PieChart>
                  <Pie data={chartRows} dataKey="value" nameKey="name" outerRadius="75%" label>
                    {chartRows.map((_entry, index: number) => (
                      <Cell key={index} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              ) : (chartType ?? "bar") === "line" ? (
                <LineChart data={chartRows}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} />
                  <Tooltip />
                  <Line type="monotone" dataKey="value" stroke="var(--primary)" strokeWidth={2} />
                </LineChart>
              ) : (
                <BarChart data={chartRows}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} />
                  <Tooltip />
                  <Bar dataKey="value" fill="var(--primary)" radius={4} />
                </BarChart>
              )}
            </ResponsiveContainer>
          </div>
        </>
      )}

      {type === "list" && (
        <ul className="nowheel flex-1 space-y-1 overflow-auto px-4 py-2 text-xs">
          {rows.map((row, index) => (
            <li key={index} className="flex gap-2">
              <span className="text-muted-foreground">•</span>
              <input
                defaultValue={row[0] ?? ""}
                onBlur={(e) => {
                  const next = rows.map((r, i) => (i === index ? [e.target.value] : r));
                  updateNode(record.id, {
                    metadata: { ...(record.metadata ?? {}), rows: next },
                    content: next.map((r) => `- ${r[0] ?? ""}`).join("\n"),
                  });
                }}
                className="nodrag flex-1 bg-transparent outline-none"
              />
            </li>
          ))}
          {rows.length === 0 && <li className="text-muted-foreground">Keine Einträge</li>}
        </ul>
      )}

      {type === "table" && (
        <div className="nowheel flex-1 overflow-auto">
          <table className="w-full border-collapse text-xs">
            <thead className="sticky top-0 bg-secondary/80">
              <tr>
                {columns.map((column, index) => (
                  <th key={index} className="border-b px-2 py-1 text-left font-medium">
                    {column}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, rowIndex) => (
                <tr key={rowIndex} className="odd:bg-secondary/30">
                  {columns.map((_, colIndex) => (
                    <td key={colIndex} className="border-b px-2 py-1 align-top">
                      <input
                        defaultValue={row[colIndex] ?? ""}
                        onBlur={(e) => {
                          const next = rows.map((r, i) =>
                            i === rowIndex
                              ? r.map((cell, c) => (c === colIndex ? e.target.value : cell))
                              : r,
                          );
                          updateNode(record.id, {
                            metadata: { ...(record.metadata ?? {}), rows: next },
                            content: toTableText(columns, next),
                          });
                        }}
                        className="nodrag w-full bg-transparent outline-none"
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Shell>
  );
});

export function toTableText(columns: string[], rows: string[][]) {
  return [columns.join(" | "), ...rows.map((row) => row.join(" | "))].join("\n");
}

type Msg = { id?: string; role: "user" | "assistant"; content: string };

export const ChatNode = memo(function ChatNode({ data, selected }: NodeProps) {
  const record = (data as unknown as Data).record;
  const { collectContext, contextReport, addNoteFrom, focusNode } = useBoard();
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [model, setModel] = useState(
    (record.metadata?.["model"] as string | undefined) ?? MODELS[0]!.id,
  );
  const { updateNode } = useBoard();
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;
    void supabase
      .from("chat_messages")
      .select("id,role,content")
      .eq("node_id", record.id)
      .order("created_at", { ascending: true })
      .then(({ data: rows }) => {
        if (active && rows) setMessages(rows as Msg[]);
      });
    return () => {
      active = false;
    };
  }, [record.id]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  async function send(promptText: string) {
    const prompt = promptText.trim();
    if (!prompt || streaming) return;
    setInput("");
    const context = collectContext(record.id);
    const next: Msg[] = [...messages, { role: "user", content: prompt }];
    setMessages([...next, { role: "assistant", content: "" }]);
    setStreaming(true);

    void supabase
      .from("chat_messages")
      .insert({ node_id: record.id, user_id: record.user_id, role: "user", content: prompt });

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model, context, messages: next }),
      });
      if (!response.ok || !response.body) {
        throw new Error((await response.text()) || "Antwort fehlgeschlagen");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let answer = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        answer += decoder.decode(value, { stream: true });
        setMessages([...next, { role: "assistant", content: answer }]);
      }

      if (answer.trim()) {
        void supabase.from("chat_messages").insert({
          node_id: record.id,
          user_id: record.user_id,
          role: "assistant",
          content: answer,
        });
      } else {
        setMessages([
          ...next,
          { role: "assistant", content: "Es kam keine Antwort zurück. Bitte erneut versuchen." },
        ]);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Antwort fehlgeschlagen");
      setMessages(next);
    } finally {
      setStreaming(false);
    }
  }

  const lastAnswer = [...messages].reverse().find((m) => m.role === "assistant")?.content;

  return (
    <Shell
      type="chat"
      selected={selected}
      locked={Boolean(record.parent_id)}
      minWidth={320}
      minHeight={320}
    >
      <Header record={record} />
      <div className="flex items-center gap-2 border-b px-3 py-1.5">
        <Select
          value={model}
          onValueChange={(value) => {
            setModel(value);
            updateNode(record.id, {
              metadata: { ...(record.metadata ?? {}), model: value },
            });
          }}
        >
          <SelectTrigger className="nodrag h-7 w-full text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {MODELS.map((m) => (
              <SelectItem key={m.id} value={m.id} className="text-xs">
                {m.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <ContextBar report={contextReport(record.id)} onFocus={focusNode} />

      <div ref={scrollRef} className="nowheel flex-1 space-y-2 overflow-auto px-3 py-2">
        {messages.length === 0 && (
          <p className="text-xs text-muted-foreground">
            Verbinde Module mit diesem Chat und stelle deine Frage.
          </p>
        )}
        {messages.map((m, index) => (
          <div
            key={m.id ?? index}
            className={
              m.role === "user"
                ? "ml-6 rounded-xl bg-secondary px-2.5 py-1.5 text-xs whitespace-pre-wrap"
                : "mr-2 rounded-xl bg-accent/60 px-2.5 py-1.5 text-xs whitespace-pre-wrap"
            }
          >
            {m.content || (streaming ? "…" : "")}
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-1 border-t px-2 py-1.5">
        {QUICK_PROMPTS.map((q) => (
          <button
            key={q.label}
            className="nodrag rounded-full border px-2 py-0.5 text-[10px] text-muted-foreground hover:bg-secondary"
            onClick={() => void send(q.text)}
            disabled={streaming}
          >
            {q.label}
          </button>
        ))}
        {lastAnswer && (
          <button
            className="nodrag rounded-full border px-2 py-0.5 text-[10px] text-muted-foreground hover:bg-secondary"
            onClick={() => addNoteFrom(record.id, lastAnswer)}
          >
            Als Notiz ablegen
          </button>
        )}
      </div>

      <div className="flex items-end gap-1.5 border-t p-2">
        <Textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send(input);
            }
          }}
          rows={2}
          placeholder="Frage stellen …"
          className="nodrag nowheel min-h-0 resize-none text-xs"
        />
        <Button size="sm" className="h-8" onClick={() => void send(input)} disabled={streaming}>
          {streaming ? "…" : "Senden"}
        </Button>
      </div>
    </Shell>
  );
});

/* ---------------------------------------------------------------- shapes */

export interface ShapeKind {
  id: string;
  label: string;
  /** CSS clip-path for angular shapes; undefined means a plain box. */
  clip?: string;
  radius?: string;
}

export const SHAPES: readonly ShapeKind[] = [
  { id: "rect", label: "Rechteck", radius: "0.25rem" },
  { id: "rounded", label: "Abgerundet", radius: "1.25rem" },
  { id: "ellipse", label: "Ellipse", radius: "50%" },
  { id: "triangle", label: "Dreieck", clip: "polygon(50% 0%, 100% 100%, 0% 100%)" },
  { id: "diamond", label: "Raute", clip: "polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)" },
  {
    id: "arrow",
    label: "Pfeil",
    clip: "polygon(0% 25%, 60% 25%, 60% 0%, 100% 50%, 60% 100%, 60% 75%, 0% 75%)",
  },
  {
    id: "star",
    label: "Stern",
    clip: "polygon(50% 0%, 61% 35%, 98% 35%, 68% 57%, 79% 91%, 50% 70%, 21% 91%, 32% 57%, 2% 35%, 39% 35%)",
  },
] as const;

export const SHAPE_COLORS: readonly ZoneColor[] = ZONE_COLORS;

export function shapeKind(record: NodeRecord): ShapeKind {
  const meta = (record.metadata ?? {}) as Record<string, unknown>;
  return SHAPES.find((item) => item.id === meta["shape"]) ?? SHAPES[0]!;
}

export const ShapeNode = memo(function ShapeNode({ data, selected }: NodeProps) {
  const record = (data as unknown as Data).record;
  const { updateNode } = useBoard();
  const kind = shapeKind(record);
  const color = record.color ?? "var(--chat)";
  const meta = (record.metadata ?? {}) as Record<string, unknown>;
  const [text, setText] = useState(record.content ?? "");
  const [angle, setAngle] = useState(Number(meta["rotation"] ?? 0));
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => setText(record.content ?? ""), [record.content]);
  useEffect(() => setAngle(Number(meta["rotation"] ?? 0)), [meta]);

  function startRotate(event: ReactPointerEvent) {
    event.stopPropagation();
    event.preventDefault();
    const box = wrapRef.current?.getBoundingClientRect();
    if (!box) return;
    const cx = box.left + box.width / 2;
    const cy = box.top + box.height / 2;
    let next = angle;
    const move = (e: PointerEvent) => {
      const deg = (Math.atan2(e.clientY - cy, e.clientX - cx) * 180) / Math.PI + 90;
      next = e.shiftKey ? Math.round(deg / 15) * 15 : Math.round(deg);
      setAngle(next);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      updateNode(record.id, { metadata: { ...(record.metadata ?? {}), rotation: next } });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  return (
    <div ref={wrapRef} className="h-full w-full" style={{ transform: `rotate(${angle}deg)` }}>
      <NodeResizer
        minWidth={80}
        minHeight={60}
        isVisible={Boolean(selected)}
        color="var(--primary)"
      />
      <Handle type="target" position={Position.Left} />
      <Handle type="target" position={Position.Top} />
      <div
        className="flex h-full w-full items-center justify-center p-3 transition-shadow"
        style={{
          background:
            color === ZONE_WHITE ? "var(--card)" : `color-mix(in oklab, ${color} 18%, var(--card))`,
          ...(kind.clip
            ? { clipPath: kind.clip }
            : {
                borderRadius: kind.radius,
                border: `1.5px solid ${
                  color === ZONE_WHITE ? "var(--border)" : `color-mix(in oklab, ${color} 45%, transparent)`
                }`,
                boxShadow: selected ? "var(--shadow-float)" : "var(--shadow-card)",
              }),
        }}
      >
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => text !== record.content && updateNode(record.id, { content: text })}
          placeholder="Text"
          rows={1}
          className="nodrag nowheel w-full resize-none bg-transparent text-center text-xs font-medium text-foreground outline-none placeholder:text-muted-foreground"
        />
      </div>
      <Handle type="source" position={Position.Right} />
      <Handle type="source" position={Position.Bottom} />
      {selected ? (
        <button
          aria-label="Form drehen"
          onPointerDown={startRotate}
          className="nodrag absolute -top-8 left-1/2 size-5 -translate-x-1/2 cursor-grab rounded-full border border-border bg-card shadow-[var(--shadow-card)]"
        >
          <RotateCw className="mx-auto size-3 text-muted-foreground" />
        </button>
      ) : null}
    </div>
  );
});

/* ------------------------------------------------------------------ text */

export interface TextSize {
  id: string;
  label: string;
  className: string;
}

export const TEXT_SIZES: readonly TextSize[] = [
  { id: "s", label: "Klein", className: "text-sm font-medium" },
  { id: "m", label: "Mittel", className: "font-display text-lg font-semibold tracking-tight" },
  { id: "l", label: "Groß", className: "font-display text-2xl font-semibold tracking-tight" },
] as const;

export function textSize(record: NodeRecord): TextSize {
  const meta = (record.metadata ?? {}) as Record<string, unknown>;
  return TEXT_SIZES.find((item) => item.id === meta["textSize"]) ?? TEXT_SIZES[1]!;
}

export interface TextOption {
  id: string;
  label: string;
  value: string;
}

/** Schriftarten aus dem Designsystem. */
export const TEXT_FONTS: readonly TextOption[] = [
  { id: "sans", label: "Fließtext", value: "var(--font-sans)" },
  { id: "display", label: "Überschrift", value: "var(--font-display)" },
  { id: "mono", label: "Technisch", value: "var(--font-mono)" },
] as const;

export const TEXT_ALIGNS: readonly TextOption[] = [
  { id: "left", label: "Linksbündig", value: "left" },
  { id: "center", label: "Zentriert", value: "center" },
  { id: "right", label: "Rechtsbündig", value: "right" },
] as const;

export const TEXT_COLORS: readonly ZoneColor[] = [
  { name: "Standard", value: "var(--foreground)" },
  { name: "Rot", value: "var(--video)" },
  { name: "Violett", value: "var(--audio)" },
  { name: "Blau", value: "var(--doc)" },
  { name: "Amber", value: "var(--note)" },
  { name: "Petrol", value: "var(--chat)" },
  { name: "Grau", value: "var(--muted-foreground)" },
] as const;

export const TEXT_BACKGROUNDS: readonly ZoneColor[] = [
  { name: "Ohne", value: "none" },
  { name: "Weiß", value: ZONE_WHITE },
  { name: "Salbei", value: "var(--frame)" },
  { name: "Amber", value: "var(--note)" },
  { name: "Blau", value: "var(--doc)" },
  { name: "Petrol", value: "var(--chat)" },
] as const;

export function textStyle(record: NodeRecord) {
  const meta = (record.metadata ?? {}) as Record<string, unknown>;
  const font = TEXT_FONTS.find((item) => item.id === meta["textFont"]) ?? TEXT_FONTS[0]!;
  const align = TEXT_ALIGNS.find((item) => item.id === meta["textAlign"]) ?? TEXT_ALIGNS[0]!;
  const color =
    TEXT_COLORS.find((item) => item.value === meta["textColor"]) ?? TEXT_COLORS[0]!;
  const background =
    TEXT_BACKGROUNDS.find((item) => item.value === meta["textBg"]) ?? TEXT_BACKGROUNDS[0]!;
  return { font, align, color, background };
}

function TextToolbar({ record }: { record: NodeRecord }) {
  const { updateNode } = useBoard();
  const style = textStyle(record);
  const patch = (key: string, value: string) =>
    updateNode(record.id, { metadata: { ...(record.metadata ?? {}), [key]: value } });

  const chip = (active: boolean) =>
    `rounded-full px-2 py-0.5 text-[11px] transition-colors ${
      active ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-secondary"
    }`;

  return (
    <div
      className="nodrag nowheel absolute -top-11 left-0 z-30 flex items-center gap-1 rounded-xl border border-border/70 bg-card/95 px-1.5 py-1 shadow-[var(--shadow-float)] backdrop-blur"
      onDoubleClick={(event) => event.stopPropagation()}
    >
      {TEXT_FONTS.map((font) => (
        <button
          key={font.id}
          title={font.label}
          style={{ fontFamily: font.value }}
          className={chip(style.font.id === font.id)}
          onClick={() => patch("textFont", font.id)}
        >
          Aa
        </button>
      ))}
      <span className="mx-0.5 h-4 w-px bg-border/70" />
      {TEXT_ALIGNS.map((align) => (
        <button
          key={align.id}
          title={align.label}
          className={chip(style.align.id === align.id)}
          onClick={() => patch("textAlign", align.id)}
        >
          {align.id === "left" ? "⌐" : align.id === "center" ? "≡" : "¬"}
        </button>
      ))}
      <span className="mx-0.5 h-4 w-px bg-border/70" />
      {TEXT_COLORS.map((color) => (
        <button
          key={color.name}
          title={`Schriftfarbe: ${color.name}`}
          onClick={() => patch("textColor", color.value)}
          className={`size-4 rounded-full border ${
            style.color.value === color.value ? "border-foreground" : "border-border/70"
          }`}
          style={{ background: color.value }}
        />
      ))}
      <span className="mx-0.5 h-4 w-px bg-border/70" />
      {TEXT_BACKGROUNDS.map((bg) => (
        <button
          key={bg.name}
          title={`Hintergrund: ${bg.name}`}
          onClick={() => patch("textBg", bg.value)}
          className={`size-4 rounded-md border text-[9px] leading-none ${
            style.background.value === bg.value ? "border-foreground" : "border-border/70"
          }`}
          style={{
            background:
              bg.value === "none"
                ? "transparent"
                : bg.value === ZONE_WHITE
                  ? "var(--card)"
                  : `color-mix(in oklab, ${bg.value} 30%, var(--card))`,
          }}
        >
          {bg.value === "none" ? "∅" : ""}
        </button>
      ))}
    </div>
  );
}

export const TextNode = memo(function TextNode({ data, selected }: NodeProps) {
  const record = (data as unknown as Data).record;
  const { updateNode } = useBoard();
  const size = textSize(record);
  const style = textStyle(record);
  const [text, setText] = useState(record.content ?? "");
  const [editing, setEditing] = useState(false);
  const areaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => setText(record.content ?? ""), [record.content]);
  useEffect(() => {
    if (editing) areaRef.current?.focus();
  }, [editing]);
  useEffect(() => {
    if (!selected) setEditing(false);
  }, [selected]);

  function save() {
    setEditing(false);
    if (text !== record.content) {
      updateNode(record.id, { content: text, title: text.slice(0, 60) || "Text" });
    }
  }

  const boxStyle = {
    fontFamily: style.font.value,
    color: style.color.value,
    textAlign: style.align.value as "left" | "center" | "right",
    background:
      style.background.value === "none"
        ? "transparent"
        : style.background.value === ZONE_WHITE
          ? "var(--card)"
          : `color-mix(in oklab, ${style.background.value} 22%, var(--card))`,
  };

  return (
    <div className="relative flex h-full w-full items-center px-1">
      <NodeResizer
        minWidth={60}
        minHeight={28}
        isVisible={Boolean(selected)}
        color="var(--primary)"
        keepAspectRatio={false}
      />
      {selected && !editing ? <TextToolbar record={record} /> : null}
      {editing ? (
        <textarea
          ref={areaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={save}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setText(record.content ?? "");
              setEditing(false);
            }
          }}
          placeholder="Beschriftung"
          rows={1}
          style={boxStyle}
          className={`nodrag nowheel h-full w-full resize-none rounded-md px-1 outline-none ring-1 ring-ring/40 placeholder:text-muted-foreground/60 ${size.className}`}
        />
      ) : (
        <div
          onDoubleClick={() => setEditing(true)}
          style={boxStyle}
          className={`h-full w-full cursor-text overflow-hidden whitespace-pre-wrap rounded-md px-1 ${size.className}${
            selected ? " ring-1 ring-ring/40" : ""
          }`}
        >
          {text || <span className="text-muted-foreground/60">Beschriftung</span>}
        </div>
      )}
    </div>
  );
});

/** Connection with an editable value label ("25 %", "2500") at its midpoint. */
export function LabeledEdge(props: EdgeProps) {
  const { updateEdge, calcForEdge } = useBoard();
  const [path, labelX, labelY] = getBezierPath({
    sourceX: props.sourceX,
    sourceY: props.sourceY,
    sourcePosition: props.sourcePosition,
    targetX: props.targetX,
    targetY: props.targetY,
    targetPosition: props.targetPosition,
  });
  const label = typeof props.label === "string" ? props.label : "";
  return (
    <>
      <BaseEdge
        id={props.id}
        path={path}
        interactionWidth={24}
        style={{
          stroke: props.selected ? "var(--ring)" : "var(--border)",
          strokeWidth: props.selected ? 2 : 1.5,
        }}
      />
      <EdgeLabelRenderer>
        <div
          className="nodrag nopan absolute"
          style={{
            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            pointerEvents: "all",
          }}
        >
          {props.selected ? (
            <div className="flex items-center gap-1 rounded-lg border border-border/70 bg-card p-1 shadow-[var(--shadow-float)]">
              <input
                key={label}
                autoFocus
                defaultValue={label}
                placeholder="z. B. 25 % oder x * 0,75"
                title="Leer = Wert unverändert · „25 %“ = Anteil · Zahl = fester Wert · „x * 0,75“ = Rechnung mit x als eingehendem Wert"
                aria-label="Wert der Verbindung"
                className="h-6 w-36 rounded-md border border-border bg-card px-1 text-center text-[11px] outline-none focus:ring-2 focus:ring-ring/50"

                onKeyDown={(e) => {
                  if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                  if (e.key === "Escape") {
                    (e.target as HTMLInputElement).value = label;
                    (e.target as HTMLInputElement).blur();
                  }
                }}
                onBlur={(e) => {
                  const next = e.target.value.trim();
                  if (next !== label) updateEdge(props.id, next);
                }}
              />
              <UiTooltip>
                <TooltipTrigger asChild>
                  <button
                    aria-label="Rechnung zu dieser Verbindung"
                    className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                    onClick={() => calcForEdge(props.id)}
                  >
                    <Calculator className="size-3.5" />
                  </button>
                </TooltipTrigger>
                <UiTooltipContent>Rechnung anlegen</UiTooltipContent>
              </UiTooltip>
            </div>
          ) : label ? (
            <span className="rounded-full border border-border/70 bg-card px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground shadow-sm">
              {label}
            </span>
          ) : (
            <span className="block size-2 rounded-full bg-border/60 opacity-0 transition-opacity hover:opacity-100" />
          )}
        </div>
      </EdgeLabelRenderer>
    </>
  );
}

/** Calculation module: resolves values from incoming connections and a formula. */
export const CalcNode = memo(function CalcNode({ id, data, selected }: NodeProps) {
  const record = (data as { record: NodeRecord }).record;
  const { updateNode, focusNode } = useBoard();
  const edges = useEdges();
  // subscribe to the live canvas so changes in other modules re-run the formula
  const flowNodes = useStore((state) => state.nodes);
  const records = useMemo(
    () =>
      Object.fromEntries(
        flowNodes.map((n) => [n.id, (n.data as { record: NodeRecord }).record]),
      ),
    [flowNodes],
  );
  const inputs = calcInputs(id, records, edges);
  const formula =
    typeof record.metadata?.["formula"] === "string" ? record.metadata["formula"] : "";
  const vars: Record<string, number> = {};
  for (const input of inputs) if (input.value != null) vars[input.letter] = input.value;
  const result = formula.trim() ? evalFormula(formula, vars) : null;
  const invalid = formula.trim().length > 0 && result == null;

  return (
    <div
      className={`flex h-full w-full flex-col overflow-hidden rounded-lg border bg-card shadow-[var(--shadow-card)] transition-shadow ${
        selected ? "border-ring/60 shadow-[var(--shadow-float)]" : "border-border/70"
      }`}
    >
      <NodeResizer isVisible={Boolean(selected)} minWidth={260} minHeight={180} />
      <Handle type="target" position={Position.Left} />
      <Handle type="source" position={Position.Right} />
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <span
          className="h-2 w-2 shrink-0 rounded-full"
          style={{ background: NODE_ACCENT["calc"] ?? "var(--primary)" }}
        />
        <input
          className="nodrag min-w-0 flex-1 bg-transparent text-sm font-medium outline-none"
          defaultValue={record.title ?? ""}
          key={record.id + (record.title ?? "")}
          placeholder="Rechnung"
          onBlur={(e) => {
            const next = e.target.value.trim();
            if (next !== (record.title ?? "")) updateNode(id, { title: next || "Rechnung" });
          }}
        />
      </div>
      <div className="nowheel flex-1 space-y-1 overflow-auto px-3 py-2">
        {inputs.length === 0 && (
          <p className="text-xs text-muted-foreground">
            Verbinde Module mit diesem Modul — jede Verbindung wird ein Wert (A, B, C …).
            Verbindungen lassen sich per Klick mit einem Prozentwert oder einer Zahl beschriften.
          </p>
        )}
        {inputs.map((input) => (
          <div key={input.edgeId} className="flex items-center gap-2 text-xs">
            <span className="flex size-5 shrink-0 items-center justify-center rounded-md bg-primary/10 font-mono text-[10px] font-semibold text-primary">
              {input.letter}
            </span>
            <button
              className="nodrag min-w-0 flex-1 truncate text-left hover:underline"
              onClick={() => focusNode(input.sourceId)}
              title={input.title}
            >
              {input.title}
            </button>
            {input.label && (
              <span className="shrink-0 rounded-full border border-border/70 px-1.5 font-mono text-[10px] text-muted-foreground">
                {input.label}
              </span>
            )}
            {input.label ? (
              <span className="w-16 shrink-0 text-right font-mono">{formatValue(input.value)}</span>
            ) : (
              <input
                key={input.sourceId + String(input.raw ?? "")}
                defaultValue={input.raw ?? ""}
                placeholder="Wert"
                inputMode="decimal"
                aria-label={`Wert von ${input.title}`}
                className="nodrag w-16 shrink-0 rounded-md border border-transparent bg-transparent px-1 text-right font-mono outline-none hover:border-border focus:border-border focus:bg-background"
                onBlur={(e) => {
                  const text = e.target.value.trim().replace(",", ".");
                  const next = text === "" ? null : Number(text);
                  if (next !== null && !Number.isFinite(next)) return;
                  if (next !== input.raw) {
                    const source = records[input.sourceId];
                    if (source) {
                      updateNode(input.sourceId, {
                        metadata: { ...(source.metadata ?? {}), value: next },
                      });
                    }
                  }
                }}
              />
            )}
          </div>
        ))}
      </div>
      <div className="border-t px-3 py-2">
        <input
          key={record.id + formula}
          defaultValue={formula}
          placeholder={inputs.length > 1 ? "Formel, z. B. A * B" : "Formel, z. B. A * 2"}
          aria-label="Formel"
          className="nodrag w-full rounded-md border border-border/70 bg-background px-2 py-1 font-mono text-xs outline-none focus:ring-2 focus:ring-ring/50"
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          }}
          onBlur={(e) => {
            const next = e.target.value.trim();
            if (next !== formula) {
              updateNode(id, { metadata: { ...(record.metadata ?? {}), formula: next } });
            }
          }}
        />
        <div className="mt-1.5 flex items-baseline justify-between">
          <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            Ergebnis
          </span>
          <span
            className={`font-display text-lg font-semibold tracking-tight ${
              invalid ? "text-destructive" : ""
            }`}
          >
            {invalid ? "Formel unvollständig" : formatValue(result)}
          </span>
        </div>
      </div>
    </div>
  );
});

/** Big single number with unit and an optional comparison line. */
/** Incoming connection values of a module (A, B … like in calculations). */
function useIncoming(id: string) {
  const edges = useEdges();
  const flowNodes = useStore((state) => state.nodes);
  const records = useMemo(
    () => Object.fromEntries(flowNodes.map((n) => [n.id, (n.data as { record: NodeRecord }).record])),
    [flowNodes],
  );
  return calcInputs(id, records, edges);
}

/** Small format bar: decimal places, prefix and suffix (metadata.numFormat). */
function FormatRow({ meta, onPatch }: { meta: Record<string, unknown>; onPatch: (next: Record<string, unknown>) => void }) {
  const fmt = (meta["numFormat"] ?? {}) as Record<string, unknown>;
  const decimals = typeof fmt["decimals"] === "number" ? fmt["decimals"] : null;
  const prefix = typeof fmt["prefix"] === "string" ? fmt["prefix"] : "";
  const suffix = typeof fmt["suffix"] === "string" ? fmt["suffix"] : "";
  function setFmt(next: Record<string, unknown>) {
    onPatch({ numFormat: next });
  }
  const field =
    "nodrag min-w-0 rounded-md border border-transparent bg-transparent px-1 py-0.5 text-[10px] outline-none hover:border-border focus:border-border";
  return (
    <div className="flex items-center gap-1 border-t border-border/60 px-2 py-1 text-[10px] text-muted-foreground">
      <input
        defaultValue={prefix}
        placeholder="Vor"
        aria-label="Text vor dem Wert"
        className={`${field} w-12 text-left`}
        onBlur={(e) => setFmt({ ...fmt, prefix: e.target.value })}
      />
      <select
        value={decimals == null ? "auto" : String(decimals)}
        aria-label="Dezimalstellen"
        className={`${field} cursor-pointer`}
        onChange={(e) => setFmt({ ...fmt, decimals: e.target.value === "auto" ? null : Number(e.target.value) })}
      >
        <option value="auto">Auto</option>
        <option value="0">0</option>
        <option value="1">1</option>
        <option value="2">2</option>
        <option value="3">3</option>
      </select>
      <input
        defaultValue={suffix}
        placeholder="Nach"
        aria-label="Text nach dem Wert"
        className={`${field} w-12 flex-1 text-left`}
        onBlur={(e) => setFmt({ ...fmt, suffix: e.target.value })}
      />
    </div>
  );
}

/** Pick which incoming connection a metric/gauge displays. */
function SourcePicker({
  inputs,
  value,
  onChange,
}: {
  inputs: ReturnType<typeof useIncoming>;
  value: string;
  onChange: (edgeId: string) => void;
}) {
  if (inputs.length === 0) return null;
  return (
    <select
      value={value}
      aria-label="Quelle"
      className="nodrag mt-1 w-full cursor-pointer rounded-md border border-border/70 bg-background px-1 py-0.5 text-[10px] text-muted-foreground outline-none"
      onChange={(e) => onChange(e.target.value)}
    >
      {inputs.map((input) => (
        <option key={input.edgeId} value={input.edgeId}>
          {input.title}
          {input.label ? ` (${input.label})` : ""}
          {input.value == null ? " – kein Wert" : ""}
        </option>
      ))}
    </select>
  );
}

/** The incoming connection a module shows: the chosen one, else the first with a value. */
function pickLinked(inputs: ReturnType<typeof useIncoming>, chosen: unknown) {
  const byId = typeof chosen === "string" ? inputs.find((input) => input.edgeId === chosen) : undefined;
  return byId ?? inputs.find((input) => input.value != null);
}

export const MetricNode = memo(function MetricNode({ id, data, selected }: NodeProps) {
  const record = (data as unknown as Data).record;
  const { updateNode } = useBoard();
  const meta = (record.metadata ?? {}) as Record<string, unknown>;
  const manual = typeof meta["value"] === "number" ? meta["value"] : Number(meta["value"] ?? NaN);
  const unit = typeof meta["unit"] === "string" ? meta["unit"] : "";
  const base = readFormat(meta);
  // a unit typed before the format bar existed keeps working as a suffix
  const fmt = base.suffix || !unit ? base : { ...base, suffix: unit };
  const compare = typeof meta["compare"] === "string" ? meta["compare"] : "";
  const inputs = useIncoming(id);
  const linked = pickLinked(inputs, meta["sourceEdge"]);
  const value = linked?.value ?? manual;
  function patch(next: Record<string, unknown>) {
    updateNode(record.id, { metadata: { ...(record.metadata ?? {}), ...next } });
  }
  return (
    <div
      className={`flex h-full w-full flex-col overflow-hidden rounded-lg border bg-card shadow-[var(--shadow-card)] ${
        selected ? "border-ring/60 shadow-[var(--shadow-float)]" : "border-border/70"
      }`}
    >
      <NodeResizer isVisible={Boolean(selected)} minWidth={180} minHeight={130} />
      <Handle type="target" position={Position.Left} />
      <Handle type="target" position={Position.Top} />
      <Handle type="source" position={Position.Right} />
      <Handle type="source" position={Position.Bottom} />
      <input
        key={record.id + (record.title ?? "")}
        defaultValue={record.title ?? "Kennzahl"}
        className="nodrag border-b bg-transparent px-3 py-2 text-sm font-medium outline-none"
        onBlur={(e) => updateNode(record.id, { title: e.target.value.trim() || "Kennzahl" })}
      />
      <div className="flex flex-1 flex-col justify-center px-3 py-2">
        <div className="flex items-baseline gap-1">
          {(() => {
            const shown = linked ? linked.value : Number.isFinite(value) ? value : null;
            const text = formatValue(shown ?? null, fmt);
            const size = text.length > 12 ? "text-lg" : text.length > 8 ? "text-2xl" : "text-3xl";
            return linked ? (
              <span className={`min-w-0 flex-1 truncate font-display font-semibold tracking-tight ${size}`}>
                {text}
              </span>
            ) : null;
          })()}
          {linked ? null : (
            <input
              key={record.id + String(meta["value"] ?? "")}
              defaultValue={Number.isFinite(manual) ? String(manual) : ""}
              inputMode="decimal"
              placeholder="0"
              aria-label="Wert"
              className="nodrag min-w-0 flex-1 bg-transparent font-display text-3xl font-semibold tracking-tight outline-none"
              onBlur={(e) => {
                const text = e.target.value.trim().replace(",", ".");
                patch({ value: text === "" ? null : Number(text) });
              }}
            />
          )}
        </div>
        {linked ? (
          <p className="mt-1 truncate text-[10px] text-muted-foreground">
            {linked.value == null ? "Verbunden mit" : "Wert aus"} {linked.title}
            {linked.label ? ` (${linked.label})` : ""}
          </p>
        ) : null}
        {selected ? (
          <SourcePicker
            inputs={inputs}
            value={typeof meta["sourceEdge"] === "string" ? (meta["sourceEdge"] as string) : (linked?.edgeId ?? "")}
            onChange={(edgeId) => patch({ sourceEdge: edgeId })}
          />
        ) : null}
        <input
          key={record.id + compare}
          defaultValue={compare}
          placeholder="Vergleich, z. B. +12 % zum Vormonat"
          aria-label="Vergleich"
          className="nodrag mt-1 bg-transparent text-xs text-muted-foreground outline-none"
          onBlur={(e) => patch({ compare: e.target.value.trim() })}
        />
        {selected ? <FormatRow meta={meta} onPatch={patch} /> : null}
      </div>
    </div>
  );
});


function arc(cx: number, cy: number, r: number, from: number, to: number) {
  const point = (angle: number) => {
    const rad = (Math.PI * angle) / 180;
    return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)];
  };
  const [x1, y1] = point(from);
  const [x2, y2] = point(to);
  return `M ${x1} ${y1} A ${r} ${r} 0 ${to - from > 180 ? 1 : 0} 1 ${x2} ${y2}`;
}

/** Gauge with free min/max and two thresholds (green → orange → red). */
export const GaugeNode = memo(function GaugeNode({ id, data, selected }: NodeProps) {
  const record = (data as unknown as Data).record;
  const { updateNode } = useBoard();
  const meta = (record.metadata ?? {}) as Record<string, unknown>;
  const num = (key: string, fallback: number) => {
    const raw = meta[key];
    const parsed = typeof raw === "number" ? raw : Number(raw);
    return Number.isFinite(parsed) ? parsed : fallback;
  };
  const min = num("min", 0);
  const max = num("max", 100);
  const warn = num("warn", 60);
  const danger = num("danger", 85);
  const inputs = useIncoming(id);
  const linked = pickLinked(inputs, meta["sourceEdge"]);
  const value = (linked ? linked.value : null) ?? (linked ? min : num("value", min));
  const fmt = readFormat(meta);

  function patchFmt(next: Record<string, unknown>) {
    updateNode(record.id, { metadata: { ...(record.metadata ?? {}), ...next } });
  }

  const span = max - min || 1;
  const ratio = Math.min(1, Math.max(0, (value - min) / span));
  const angle = 180 + ratio * 180;
  const GREEN = "oklch(0.62 0.15 150)";
  const ORANGE = "oklch(0.72 0.17 65)";
  const RED = "oklch(0.58 0.2 27)";
  const colour = value >= danger ? RED : value >= warn ? ORANGE : GREEN;
  // the track shows the three ranges green → orange → red
  const angleOf = (v: number) => 180 + Math.min(1, Math.max(0, (v - min) / (max - min || 1))) * 180;
  const zones = [
    { from: 180, to: angleOf(warn), colour: GREEN },
    { from: angleOf(warn), to: angleOf(danger), colour: ORANGE },
    { from: angleOf(danger), to: 360, colour: RED },
  ].filter((zone) => zone.to - zone.from > 0.2);
  function patch(key: string, raw: string) {
    const text = raw.trim().replace(",", ".");
    updateNode(record.id, {
      metadata: { ...(record.metadata ?? {}), [key]: text === "" ? null : Number(text) },
    });
  }
  return (
    <div
      className={`flex h-full w-full flex-col overflow-hidden rounded-lg border bg-card shadow-[var(--shadow-card)] ${
        selected ? "border-ring/60 shadow-[var(--shadow-float)]" : "border-border/70"
      }`}
    >
      <NodeResizer isVisible={Boolean(selected)} minWidth={220} minHeight={200} />
      <Handle type="target" position={Position.Left} />
      <Handle type="target" position={Position.Top} />
      <Handle type="source" position={Position.Right} />
      <Handle type="source" position={Position.Bottom} />

      <input
        key={record.id + (record.title ?? "")}
        defaultValue={record.title ?? "Tacho"}
        className="nodrag border-b bg-transparent px-3 py-2 text-sm font-medium outline-none"
        onBlur={(e) => updateNode(record.id, { title: e.target.value.trim() || "Tacho" })}
      />
      <div className="flex flex-1 flex-col items-center justify-center px-3 py-2">
        <svg viewBox="0 0 200 110" className="w-full max-w-56">
          <path d={arc(100, 100, 80, 180, 360)} fill="none" stroke="var(--border)" strokeWidth={14} strokeLinecap="round" />
          {zones.map((zone) => (
            <path
              key={zone.colour}
              d={arc(100, 100, 80, zone.from, zone.to)}
              fill="none"
              stroke={zone.colour}
              strokeWidth={14}
              strokeOpacity={0.22}
            />
          ))}
          <path
            d={arc(100, 100, 80, 180, Math.max(180.1, angle))}
            fill="none"
            stroke={colour}
            strokeWidth={14}
            strokeLinecap="round"
          />
          <text x="100" y="94" textAnchor="middle" className="fill-foreground" style={{ fontSize: 26, fontWeight: 600 }}>
            {formatValue(value, fmt)}
          </text>
        </svg>
        <div className="mt-1 grid w-full grid-cols-4 gap-1 text-[10px] text-muted-foreground">
          {(["min", "warn", "danger", "max"] as const).map((key) => (
            <label key={key} className="flex flex-col items-center">
              <span className="uppercase">{key}</span>
              <input
                key={record.id + key + String(meta[key] ?? "")}
                defaultValue={String(num(key, key === "max" ? 100 : key === "warn" ? 60 : key === "danger" ? 85 : 0))}
                inputMode="decimal"
                aria-label={key}
                className="nodrag w-full rounded-md border border-transparent bg-transparent text-center font-mono outline-none hover:border-border focus:border-border"
                onBlur={(e) => patch(key, e.target.value)}
              />
            </label>
          ))}
        </div>
        {linked ? (
          <p className="mt-1 w-full truncate text-center text-[10px] text-muted-foreground">
            {linked.value == null ? "Verbunden mit" : "Wert aus"} {linked.title}
            {linked.label ? ` (${linked.label})` : ""}
          </p>
        ) : (
          <input
            key={record.id + "value" + String(meta["value"] ?? "")}
            defaultValue={String(value)}
            inputMode="decimal"
            aria-label="Wert"
            placeholder="Wert"
            className="nodrag mt-1 w-full rounded-md border border-border/70 bg-background px-2 py-1 text-center font-mono text-xs outline-none focus:ring-2 focus:ring-ring/50"
            onBlur={(e) => patch("value", e.target.value)}
          />
        )}
        {selected ? (
          <>
            <SourcePicker
              inputs={inputs}
              value={typeof meta["sourceEdge"] === "string" ? (meta["sourceEdge"] as string) : (linked?.edgeId ?? "")}
              onChange={(edgeId) =>
                updateNode(record.id, { metadata: { ...(record.metadata ?? {}), sourceEdge: edgeId } })
              }
            />
            <div className="w-full">
              <FormatRow meta={meta} onPatch={patchFmt} />
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
});

/** Small spreadsheet: rows with name, value or formula (R1, R2 … and inputs A, B …). */
export const SheetNode = memo(function SheetNode({ id, data, selected }: NodeProps) {
  const record = (data as unknown as Data).record;
  const { updateNode } = useBoard();
  const edges = useEdges();
  const flowNodes = useStore((state) => state.nodes);
  const records = useMemo(
    () => Object.fromEntries(flowNodes.map((n) => [n.id, (n.data as { record: NodeRecord }).record])),
    [flowNodes],
  );
  const inputs = calcInputs(id, records, edges);
  const extra: Record<string, number> = {};
  for (const input of inputs) if (input.value != null) extra[input.letter] = input.value;
  const rows = sheetRows(record);
  const values = sheetValues(record, extra);
  const output = sheetOutputRow(record);

  function writeRows(next: { name: string; value: string; formula: string }[]) {
    updateNode(record.id, { metadata: { ...(record.metadata ?? {}), rows: next } });
  }

  return (
    <div
      className={`flex h-full w-full flex-col overflow-hidden rounded-lg border bg-card shadow-[var(--shadow-card)] ${
        selected ? "border-ring/60 shadow-[var(--shadow-float)]" : "border-border/70"
      }`}
    >
      <NodeResizer isVisible={Boolean(selected)} minWidth={280} minHeight={180} />
      <Handle type="target" position={Position.Left} />
      <Handle type="source" position={Position.Right} />
      <input
        key={record.id + (record.title ?? "")}
        defaultValue={record.title ?? "Rechenblatt"}
        className="nodrag border-b bg-transparent px-3 py-2 text-sm font-medium outline-none"
        onBlur={(e) => updateNode(record.id, { title: e.target.value.trim() || "Rechenblatt" })}
      />
      <div className="nowheel flex-1 overflow-auto px-2 py-1.5">
        {inputs.length > 0 && (
          <p className="mb-1 text-[10px] text-muted-foreground">
            Eingänge: {inputs.map((input) => `${input.letter} = ${input.title}`).join(", ")}
          </p>
        )}
        {rows.length === 0 && (
          <p className="text-xs text-muted-foreground">
            Noch keine Zeilen. Zeilen verweisen aufeinander mit R1, R2 … und auf Eingänge mit A, B …
          </p>
        )}
        {rows.map((row, index) => (
          <div key={index} className="flex items-center gap-1 py-0.5 text-xs">
            <button
              title={output === index ? "Wird weitergegeben" : "Diese Zeile weitergeben"}
              aria-label={`Zeile ${index + 1} weitergeben`}
              className={`nodrag w-6 shrink-0 rounded-md font-mono text-[10px] ${
                output === index
                  ? "bg-accent font-semibold text-accent-foreground"
                  : "text-muted-foreground hover:bg-accent"
              }`}
              onClick={() =>
                updateNode(record.id, {
                  metadata: { ...(record.metadata ?? {}), outputRow: output === index ? null : index },
                })
              }
            >
              R{index + 1}
            </button>
            <input
              defaultValue={row.name}
              key={`n${index}${row.name}`}
              placeholder="Name"
              aria-label={`Name Zeile ${index + 1}`}
              className="nodrag min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-1 outline-none hover:border-border focus:border-border"
              onBlur={(e) => {
                const next = [...rows];
                next[index] = { ...row, name: e.target.value };
                writeRows(next);
              }}
            />
            <input
              defaultValue={row.formula || row.value}
              key={`v${index}${row.formula}${row.value}`}
              placeholder="Wert oder =R1*A"
              aria-label={`Wert Zeile ${index + 1}`}
              className="nodrag w-28 shrink-0 rounded-md border border-transparent bg-transparent px-1 text-right font-mono outline-none hover:border-border focus:border-border"
              onBlur={(e) => {
                const text = e.target.value.trim();
                const formula = text.startsWith("=") ? text.slice(1).trim() : /[A-Za-z(]/.test(text) ? text : "";
                const next = [...rows];
                next[index] = { name: row.name, value: formula ? "" : text, formula };
                writeRows(next);
              }}
            />
            <span className="w-16 shrink-0 text-right font-mono text-[11px] text-muted-foreground">
              {formatValue(values[index] ?? null)}
            </span>
            <button
              aria-label={`Zeile ${index + 1} löschen`}
              className="nodrag shrink-0 rounded-md p-1 text-muted-foreground hover:bg-accent"
              onClick={() => writeRows(rows.filter((_, other) => other !== index))}
            >
              <Trash2 className="size-3" />
            </button>
          </div>
        ))}
        <button
          className="nodrag mt-1 flex items-center gap-1 rounded-md px-1 py-1 text-[11px] text-muted-foreground hover:bg-accent"
          onClick={() => writeRows([...rows, { name: "", value: "", formula: "" }])}
        >
          <Plus className="size-3" /> Zeile
        </button>
      </div>
    </div>
  );
});

/** Calls a web API (SerpAPI, weather, own endpoints) and holds its answer. */
export const ApiNode = memo(function ApiNode({ data, selected }: NodeProps) {
  const record = (data as unknown as Data).record;
  const { updateNode, runApi, openInspector } = useBoard();
  const config = readApi(record);
  const meta = (record.metadata ?? {}) as Record<string, unknown>;
  const running = meta["apiRunning"] === true;
  const value = apiValue(record);
  const picked = pickPath(record.content, config.pick);

  return (
    <div
      className={`flex h-full w-full flex-col overflow-hidden rounded-lg border bg-card shadow-[var(--shadow-card)] ${
        selected ? "border-ring/60 shadow-[var(--shadow-float)]" : "border-border/70"
      }`}
      style={{ borderTop: `3px solid ${NODE_ACCENT["api"] ?? "var(--primary)"}` }}
    >
      <NodeResizer isVisible={Boolean(selected)} minWidth={280} minHeight={200} />
      <Handle type="target" position={Position.Left} />
      <Handle type="source" position={Position.Right} />
      <div className="flex items-center gap-1.5 border-b px-3 py-2">
        <Globe className="size-3.5 shrink-0 text-muted-foreground" />
        <input
          key={record.id + (record.title ?? "")}
          defaultValue={record.title ?? "API"}
          className="nodrag min-w-0 flex-1 bg-transparent text-sm font-medium outline-none"
          onBlur={(e) => updateNode(record.id, { title: e.target.value.trim() || "API" })}
        />
        <button
          className="nodrag rounded-md px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-accent"
          onClick={() => openInspector(record.id, "fetch")}
        >
          Einrichten
        </button>
      </div>

      <div className="flex items-center gap-2 border-b px-3 py-1.5">
        <Button
          size="sm"
          variant="secondary"
          className="nodrag h-7 rounded-full text-xs"
          disabled={running || !config.url.trim()}
          onClick={() => runApi(record.id)}
        >
          <RefreshCw className={`mr-1 size-3 ${running ? "animate-spin" : ""}`} />
          {running ? "Ruft ab …" : "Abrufen"}
        </Button>
        <span className="truncate text-[10px] text-muted-foreground">
          {config.lastAt
            ? `${config.lastStatus ?? "–"} · ${new Date(config.lastAt).toLocaleString("de-DE")}`
            : config.url.trim()
              ? "noch nicht abgerufen"
              : "Adresse fehlt"}
        </span>
      </div>

      <div className="flex items-center gap-1 border-b px-3 py-1.5 text-[10px] text-muted-foreground">
        <span className="shrink-0">Feld</span>
        <input
          key={record.id + config.pick}
          defaultValue={config.pick}
          placeholder="z. B. trending_searches.0.search_volume"
          aria-label="Feld für die Verbindung"
          className="nodrag min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-1 py-0.5 font-mono outline-none hover:border-border focus:border-border"
          onBlur={(e) =>
            updateNode(record.id, { metadata: { ...(record.metadata ?? {}), pick: e.target.value } })
          }
        />
        <span className="shrink-0 font-mono text-foreground">
          {value != null
            ? formatValue(value)
            : typeof picked === "string"
              ? picked.slice(0, 18)
              : "–"}
        </span>
      </div>

      <pre className="nowheel nodrag flex-1 overflow-auto whitespace-pre-wrap break-words px-3 py-2 font-mono text-[10px] leading-snug text-muted-foreground">
        {apiPreview(record) || "Noch keine Antwort."}
      </pre>
    </div>
  );
});

/** Typed decisions (choice, score, yes/no) over the connected context. */
export const DecisionNode = memo(function DecisionNode({ id, data, selected }: NodeProps) {
  const record = (data as unknown as Data).record;
  const { updateNode, runDecide } = useBoard();
  const questions = readQuestions(record);
  const answers = readAnswers(record);
  const meta = (record.metadata ?? {}) as Record<string, unknown>;
  const running = meta["decideRunning"] === true;
  const output = typeof meta["outputQuestion"] === "string" ? meta["outputQuestion"] : "";
  const threshold = typeof meta["minConfidence"] === "number" ? (meta["minConfidence"] as number) : 80;
  const inputs = useIncoming(id);

  function writeQuestions(next: DecisionQuestion[]) {
    updateNode(record.id, { metadata: { ...(record.metadata ?? {}), questions: next } });
  }

  return (
    <div
      className={`flex h-full w-full flex-col overflow-hidden rounded-lg border bg-card shadow-[var(--shadow-card)] ${
        selected ? "border-ring/60 shadow-[var(--shadow-float)]" : "border-border/70"
      }`}
      style={{ borderTop: `3px solid ${NODE_ACCENT["decision"] ?? "var(--primary)"}` }}
    >
      <NodeResizer isVisible={Boolean(selected)} minWidth={300} minHeight={220} />
      <Handle type="target" position={Position.Left} />
      <Handle type="source" position={Position.Right} />
      <div className="flex items-center gap-1.5 border-b px-3 py-2">
        <Scale className="size-3.5 shrink-0 text-muted-foreground" />
        <input
          key={record.id + (record.title ?? "")}
          defaultValue={record.title ?? "Entscheidung"}
          className="nodrag min-w-0 flex-1 bg-transparent text-sm font-medium outline-none"
          onBlur={(e) => updateNode(record.id, { title: e.target.value.trim() || "Entscheidung" })}
        />
        <Button
          size="sm"
          variant="secondary"
          className="nodrag h-7 rounded-full text-xs"
          disabled={running || questions.length === 0}
          onClick={() => runDecide(record.id)}
        >
          <Sparkles className={`mr-1 size-3 ${running ? "animate-pulse" : ""}`} />
          {running ? "Prüft …" : "Entscheiden"}
        </Button>
      </div>

      <div className="nowheel flex-1 space-y-2 overflow-auto px-3 py-2">
        <p className="text-[10px] text-muted-foreground">
          {inputs.length > 0
            ? `Kontext aus ${inputs.length} Verbindung${inputs.length === 1 ? "" : "en"}`
            : "Verbinde Inhalte, Felder oder API-Module mit diesem Modul."}
        </p>
        <textarea
          key={record.id + "policy"}
          defaultValue={typeof meta["policy"] === "string" ? (meta["policy"] as string) : ""}
          placeholder="Regel für alle Fragen, z. B. Nur kaufen, wenn der 24h-Trend positiv ist."
          aria-label="Regel für alle Fragen"
          className="nodrag min-h-12 w-full resize-none rounded-md border border-border/70 bg-background px-2 py-1 text-xs outline-none"
          onBlur={(e) =>
            updateNode(record.id, {
              metadata: { ...(record.metadata ?? {}), policy: e.target.value },
            })
          }
        />
        <label className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
          Mindest-Sicherheit
          <input
            type="number"
            min={0}
            max={100}
            step={5}
            key={record.id + "minconf"}
            defaultValue={threshold}
            aria-label="Mindest-Sicherheit in Prozent"
            className="nodrag w-16 rounded-md border border-border/70 bg-background px-1 py-0.5 text-[10px]"
            onBlur={(e) => {
              const value = Number(e.target.value);
              updateNode(record.id, {
                metadata: {
                  ...(record.metadata ?? {}),
                  minConfidence: Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : 80,
                },
              });
            }}
          />
          % – darunter keine Empfehlung (gilt für alle Fragen ohne eigene Angabe)
        </label>
        {questions.map((question, index) => {
          const answer = answers.find((item) => item.id === question.id);
          const own = typeof question.minConfidence === "number" ? question.minConfidence : null;
          const limit = own ?? threshold;
          const low = typeof answer?.confidence === "number" && answer.confidence * 100 < limit;
          return (
            <div key={question.id} className="rounded-lg border border-border/70 p-2">
              <div className="flex items-start gap-1">
                <textarea
                  key={question.id + question.instructions}
                  defaultValue={question.instructions}
                  placeholder="Frage, z. B. Ist der Markt groß genug für einen Eintritt?"
                  aria-label={`Frage ${index + 1}`}
                  className="nodrag min-h-10 min-w-0 flex-1 resize-none rounded-md border border-transparent bg-transparent px-1 py-0.5 text-xs outline-none hover:border-border focus:border-border"
                  onBlur={(e) => {
                    const next = [...questions];
                    next[index] = { ...question, instructions: e.target.value };
                    writeQuestions(next);
                  }}
                />
                <button
                  aria-label={`Frage ${index + 1} löschen`}
                  className="nodrag shrink-0 rounded-md p-1 text-muted-foreground hover:bg-accent"
                  onClick={() => writeQuestions(questions.filter((_, other) => other !== index))}
                >
                  <Trash2 className="size-3" />
                </button>
              </div>
              <div className="mt-1 flex items-center gap-1">
                <select
                  value={question.type}
                  aria-label={`Art der Frage ${index + 1}`}
                  className="nodrag cursor-pointer rounded-md border border-border/70 bg-background px-1 py-0.5 text-[10px]"
                  onChange={(e) => {
                    const next = [...questions];
                    next[index] = { ...question, type: e.target.value as DecisionQuestion["type"] };
                    writeQuestions(next);
                  }}
                >
                  <option value="noul">Ja / Nein</option>
                  <option value="choice">Auswahl</option>
                  <option value="score">Bewertung</option>
                </select>
                {question.type !== "noul" && (
                  <input
                    key={question.id + question.options.join("|")}
                    defaultValue={question.options.join(", ")}
                    placeholder={
                      question.type === "choice" ? "Optionen, mit Komma" : "Stufen, mit Komma"
                    }
                    aria-label={`Optionen der Frage ${index + 1}`}
                    className="nodrag min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-1 py-0.5 text-[10px] outline-none hover:border-border focus:border-border"
                    onBlur={(e) => {
                      const next = [...questions];
                      next[index] = {
                        ...question,
                        options: e.target.value
                          .split(",")
                          .map((part) => part.trim())
                          .filter(Boolean),
                      };
                      writeQuestions(next);
                    }}
                  />
                )}
                <button
                  title="Ergebnis dieser Frage weitergeben"
                  aria-label={`Frage ${index + 1} weitergeben`}
                  className={`nodrag shrink-0 rounded-md px-1.5 py-0.5 text-[10px] ${
                    output === question.id
                      ? "bg-accent font-semibold text-accent-foreground"
                      : "text-muted-foreground hover:bg-accent"
                  }`}
                  onClick={() =>
                    updateNode(record.id, {
                      metadata: {
                        ...(record.metadata ?? {}),
                        outputQuestion: output === question.id ? null : question.id,
                      },
                    })
                  }
                >
                  ⇢
                </button>
              </div>
              <div className="mt-1 flex items-center gap-1">
                <input
                  key={question.id + "rule"}
                  defaultValue={question.rule ?? ""}
                  placeholder="Eigene Regel für diese Frage (optional)"
                  aria-label={`Regel der Frage ${index + 1}`}
                  className="nodrag min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-1 py-0.5 text-[10px] outline-none hover:border-border focus:border-border"
                  onBlur={(e) => {
                    const next = [...questions];
                    next[index] = { ...question, rule: e.target.value };
                    writeQuestions(next);
                  }}
                />
                <input
                  type="number"
                  min={0}
                  max={100}
                  step={5}
                  key={question.id + "minconf"}
                  defaultValue={own ?? ""}
                  placeholder={`${Math.round(threshold)}`}
                  title="Eigene Mindest-Sicherheit in Prozent"
                  aria-label={`Mindest-Sicherheit der Frage ${index + 1}`}
                  className="nodrag w-14 shrink-0 rounded-md border border-border/70 bg-background px-1 py-0.5 text-[10px]"
                  onBlur={(e) => {
                    const value = Number(e.target.value);
                    const next = [...questions];
                    next[index] = {
                      ...question,
                      minConfidence:
                        e.target.value.trim() === "" || !Number.isFinite(value)
                          ? null
                          : Math.min(100, Math.max(0, value)),
                    };
                    writeQuestions(next);
                  }}
                />
                <span className="shrink-0 text-[10px] text-muted-foreground">%</span>
              </div>
              {answer && (
                <p className="mt-1 text-xs">
                  <span className="font-medium">{answerLabel(answer)}</span>
                  {typeof answer.confidence === "number" && (
                    <span className={`ml-1 text-[10px] ${low ? "text-destructive" : "text-muted-foreground"}`}>
                      {low ? "zur Prüfung · " : ""}
                      {Math.round(answer.confidence * 100)} % sicher
                    </span>
                  )}
                </p>
              )}
            </div>
          );
        })}
        <button
          className="nodrag flex items-center gap-1 rounded-md px-1 py-1 text-[11px] text-muted-foreground hover:bg-accent"
          onClick={() =>
            writeQuestions([
              ...questions,
              { id: `f${Date.now().toString(36)}`, type: "noul", instructions: "", options: [] },
            ])
          }
        >
          <Plus className="size-3" /> Frage
        </button>
      </div>
    </div>
  );
});

/** Traffic light: shows the yes/no result of a connected decision in green or red. */
export const SignalNode = memo(function SignalNode({ id, data, selected }: NodeProps) {
  const record = (data as unknown as Data).record;
  const { updateNode } = useBoard();
  const edges = useEdges();
  const flowNodes = useStore((state) => state.nodes);
  const sources = useMemo(() => {
    const byId = Object.fromEntries(
      flowNodes.map((n) => [n.id, (n.data as { record: NodeRecord }).record]),
    ) as Record<string, NodeRecord>;
    return edges
      .filter((edge) => edge.target === id)
      .map((edge) => byId[edge.source])
      .filter((item): item is NodeRecord => Boolean(item));
  }, [edges, flowNodes, id]);

  const decision = sources.find((item) => item.type === "decision");
  const questions = readQuestions(decision);
  const answers = readAnswers(decision);
  const meta = (record.metadata ?? {}) as Record<string, unknown>;
  const pickedId = typeof meta["question"] === "string" ? meta["question"] : "";
  const question = questions.find((item) => item.id === pickedId) ?? questions[0];
  const answer = answers.find((item) => item.id === question?.id);
  const yes = typeof answer?.noul === "number" ? answer.noul >= 0.5 : null;
  const yesLabel = typeof meta["yesLabel"] === "string" && meta["yesLabel"] ? meta["yesLabel"] : "KAUFEN";
  const noLabel = typeof meta["noLabel"] === "string" && meta["noLabel"] ? meta["noLabel"] : "NICHT KAUFEN";
  const decisionMeta = (decision?.metadata ?? {}) as Record<string, unknown>;
  const threshold =
    typeof question?.minConfidence === "number"
      ? question.minConfidence
      : typeof decisionMeta["minConfidence"] === "number"
        ? (decisionMeta["minConfidence"] as number)
        : 80;
  const confidence = typeof answer?.confidence === "number" ? answer.confidence * 100 : null;
  const unsure = confidence !== null && confidence < threshold;

  const tone =
    yes === null
      ? { bg: "var(--muted)", fg: "var(--muted-foreground)", text: "Noch keine Entscheidung" }
      : unsure
        ? { bg: "var(--warn, #ea580c)", fg: "#ffffff", text: "KEINE EMPFEHLUNG" }
        : yes
          ? { bg: "var(--ok, #16a34a)", fg: "#ffffff", text: yesLabel }
          : { bg: "var(--danger, #dc2626)", fg: "#ffffff", text: noLabel };

  return (
    <div
      className={`flex h-full w-full flex-col overflow-hidden rounded-lg border bg-card shadow-[var(--shadow-card)] ${
        selected ? "border-ring/60 shadow-[var(--shadow-float)]" : "border-border/70"
      }`}
    >
      <NodeResizer isVisible={Boolean(selected)} minWidth={180} minHeight={140} />
      <Handle type="target" position={Position.Left} />
      <Handle type="target" position={Position.Top} />
      <input
        key={record.id + (record.title ?? "")}
        defaultValue={record.title ?? "Signal"}
        className="nodrag border-b bg-transparent px-3 py-2 text-sm font-medium outline-none"
        onBlur={(e) => updateNode(record.id, { title: e.target.value.trim() || "Signal" })}
      />
      <div
        className="flex flex-1 flex-col items-center justify-center gap-1 px-3 py-3 text-center"
        style={{ background: tone.bg, color: tone.fg }}
      >
        <span className="font-display text-4xl font-semibold leading-none tracking-tight">
          {confidence === null ? "–" : `${Math.round(confidence)} %`}
        </span>
        <span className="font-display text-base font-semibold tracking-tight">{tone.text}</span>
        {confidence !== null && (
          <span className="text-[10px] opacity-90">
            Sicherheit · Schwelle {Math.round(threshold)} %{unsure ? " nicht erreicht" : ""}
          </span>
        )}
        <span className="text-[10px] opacity-80">
          {typeof meta["hint"] === "string" && meta["hint"]
            ? (meta["hint"] as string)
            : "Simulation – kein echter Kauf"}
        </span>
      </div>
      {selected && (
        <div className="border-t px-2 py-1.5">
          <select
            value={question?.id ?? ""}
            aria-label="Frage der Entscheidung"
            className="nodrag w-full cursor-pointer rounded-md border border-border/70 bg-background px-1 py-1 text-[10px]"
            onChange={(e) =>
              updateNode(record.id, {
                metadata: { ...(record.metadata ?? {}), question: e.target.value },
              })
            }
          >
            <option value="">
              {decision ? "Frage wählen" : "Mit einem Entscheidungs-Modul verbinden"}
            </option>
            {questions.map((item) => (
              <option key={item.id} value={item.id}>
                {item.instructions.slice(0, 60) || item.id}
              </option>
            ))}
          </select>
        </div>
      )}
    </div>
  );
});

/** Price history of crypto or stock values, with a check of past decisions. */
export const QuotesNode = memo(function QuotesNode({ id, data, selected }: NodeProps) {
  const record = (data as unknown as Data).record;
  const { updateNode } = useBoard();
  const edges = useEdges();
  const flowNodes = useStore((state) => state.nodes);
  const [busy, setBusy] = useState(false);
  const config = readQuotes(record);
  const mode = readMode(record);
  const results = useMemo(() => evaluateMarks(config), [config]);
  const rate = hitRate(results);

  const records = useMemo(
    () =>
      Object.fromEntries(
        flowNodes.map((n) => [n.id, (n.data as { record: NodeRecord }).record]),
      ) as Record<string, NodeRecord>,
    [flowNodes],
  );

  const decisions = useMemo(() => {
    const connected = edges
      .filter((edge) => edge.target === id)
      .map((edge) => records[edge.source])
      .filter((item): item is NodeRecord => Boolean(item) && item?.type === "decision");
    if (connected.length > 0) return connected;
    // no direct connection: fall back to decision modules elsewhere on the board
    return Object.values(records).filter((item) => item?.type === "decision");
  }, [edges, records, id]);

  /** Amounts held per asset: manual entry wins, otherwise matched incoming values. */
  const manual = readHoldings(record);
  const inputs = useMemo(() => calcInputs(id, records, edges), [id, records, edges]);
  const linked = useMemo(() => {
    const map: Record<string, { amount: number; title: string }> = {};
    for (const asset of config.assets) {
      const match = inputs.find(
        (input) =>
          input.value != null &&
          (input.title.toLowerCase().includes(asset.label.toLowerCase()) ||
            input.title.toLowerCase().includes(asset.id.toLowerCase())),
      );
      if (match?.value != null) map[asset.id] = { amount: match.value, title: match.title };
    }
    return map;
  }, [inputs, config.assets]);

  const holdings = useMemo(() => {
    const map: Record<string, number> = {};
    for (const asset of config.assets) {
      const amount = manual[asset.id] ?? linked[asset.id]?.amount;
      if (typeof amount === "number" && amount !== 0) map[asset.id] = amount;
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(manual), linked, config.assets]);

  const rows = useMemo(() => chartRows(config, mode, holdings), [config, mode, holdings]);
  const total = mode === "value" ? totalValue(config, holdings) : null;


  function patch(next: Record<string, unknown>) {
    updateNode(record.id, { metadata: { ...(record.metadata ?? {}), ...next } });
  }

  async function loadQuotes() {
    setBusy(true);
    try {
      const series: Record<string, [number, number][]> = { ...config.series };
      for (const asset of config.assets) {
        const answer = await runApiModule({
          data: {
            url: `https://api.coingecko.com/api/v3/coins/${encodeURIComponent(asset.id)}/market_chart`,
            method: "GET",
            params: [
              { key: "vs_currency", value: config.currency },
              { key: "days", value: String(config.days) },
            ],
            headers: [],
          },
        });
        if (answer.status !== 200) throw new Error(`${asset.label}: Status ${answer.status}`);
        const parsed = JSON.parse(answer.body) as { prices?: [number, number][] };
        series[asset.id] = Array.isArray(parsed.prices) ? parsed.prices : [];
      }
      patch({ series, lastAt: new Date().toISOString() });
      toast.success("Kurse aktualisiert");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Kurse konnten nicht geladen werden");
    } finally {
      setBusy(false);
    }
  }

  /** Stores the current decisions with the live price so they can be checked later. */
  async function recordDecisions() {
    const at = new Date().toISOString();
    const added: QuoteMark[] = [];
    let live: Record<string, { eur?: number; usd?: number }> = {};
    setBusy(true);
    try {
      const answer = await runApiModule({
        data: {
          url: "https://api.coingecko.com/api/v3/simple/price",
          method: "GET",
          params: [
            { key: "ids", value: config.assets.map((asset) => asset.id).join(",") },
            { key: "vs_currencies", value: config.currency },
          ],
          headers: [],
        },
      });
      if (answer.status === 200) live = JSON.parse(answer.body) as typeof live;
    } catch {
      live = {};
    } finally {
      setBusy(false);
    }
    for (const decision of decisions) {
      const questions = readQuestions(decision);
      const answers = readAnswers(decision);
      for (const asset of config.assets) {
        const question = questions.find((item) =>
          `${item.instructions} ${item.id}`.toLowerCase().includes(asset.label.toLowerCase()) ||
          `${item.instructions} ${item.id}`.toLowerCase().includes(asset.id.toLowerCase()),
        );
        const answer = answers.find((item) => item.id === question?.id);
        if (!answer || typeof answer.noul !== "number") continue;
        const spot = (live[asset.id] as Record<string, number> | undefined)?.[config.currency];
        added.push({
          at,
          asset: asset.id,
          label: asset.label,
          buy: answer.noul >= 0.5,
          confidence: typeof answer.confidence === "number" ? answer.confidence : null,
          price: typeof spot === "number" ? spot : latestPrice(config, asset.id),
          seriesAt: latestStamp(config, asset.id),
        });
      }
    }
    if (added.length === 0) {
      toast.error(
        decisions.length === 0
          ? "Kein Entscheidungs-Modul auf dem Board"
          : "Noch kein Ergebnis – im Entscheidungs-Modul erst auf „Entscheiden“ klicken",
      );
      return;
    }
    patch({ marks: [...config.marks, ...added].slice(-60) });
    toast.success(`${added.length} Entscheidungen festgehalten`);
  }

  return (
    <div
      className={`flex h-full w-full flex-col overflow-hidden rounded-lg border bg-card shadow-[var(--shadow-card)] ${
        selected ? "border-ring/60 shadow-[var(--shadow-float)]" : "border-border/70"
      }`}
    >
      <NodeResizer isVisible={Boolean(selected)} minWidth={320} minHeight={280} />
      <Handle type="target" position={Position.Left} />
      <Handle type="target" position={Position.Top} />
      <Handle type="source" position={Position.Right} />
      <Handle type="source" position={Position.Bottom} />
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <input
          key={record.id + (record.title ?? "")}
          defaultValue={record.title ?? "Kurse"}
          className="nodrag min-w-0 flex-1 bg-transparent text-sm font-medium outline-none"
          onBlur={(e) => updateNode(record.id, { title: e.target.value.trim() || "Kurse" })}
        />
        <select
          value={mode}
          aria-label="Darstellung"
          className="nodrag cursor-pointer rounded-md border border-border/70 bg-background px-1 py-0.5 text-[10px]"
          onChange={(e) => patch({ mode: e.target.value })}
        >
          <option value="pct">Relativ %</option>
          <option value="price">Kurs</option>
          <option value="value">Depotwert</option>
        </select>
        <select
          value={String(config.days)}
          aria-label="Zeitraum"
          className="nodrag cursor-pointer rounded-md border border-border/70 bg-background px-1 py-0.5 text-[10px]"
          onChange={(e) => patch({ days: Number(e.target.value) })}
        >
          <option value="1">24 h</option>
          <option value="7">7 Tage</option>
          <option value="30">30 Tage</option>
          <option value="90">90 Tage</option>
        </select>
        <Button size="sm" variant="secondary" className="nodrag h-7 rounded-full px-2 text-[11px]" disabled={busy} onClick={() => void loadQuotes()}>
          <RefreshCw className={`size-3 ${busy ? "animate-spin" : ""}`} /> Kurse
        </Button>
      </div>

      {mode === "value" && (
        <div className="flex items-baseline justify-between gap-2 border-b px-3 py-1.5">
          <span className="text-[10px] text-muted-foreground">Depotwert gesamt</span>
          <span className="font-display text-xl font-semibold tracking-tight">
            {formatPrice(total, config.currency)}
          </span>
        </div>
      )}

      <div className="h-36 shrink-0 px-2 pt-2">
        {rows.length > 1 ? (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={rows} margin={{ top: 4, right: 8, bottom: 0, left: -18 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="t" tick={{ fontSize: 9 }} minTickGap={24} />
              <YAxis
                tick={{ fontSize: 9 }}
                {...(mode === "pct" ? { unit: "%" } : {})}
                width={mode === "pct" ? 38 : 56}
                tickFormatter={(value: number) =>
                  mode === "pct" ? String(value) : value.toLocaleString("de-DE", { notation: "compact" })
                }
              />
              <Tooltip
                formatter={(value: number) =>
                  mode === "pct" ? `${value} %` : formatPrice(value, config.currency)
                }
              />
              {mode === "value" && (
                <Line
                  type="monotone"
                  dataKey="__total"
                  name="Depotwert gesamt"
                  stroke="var(--primary)"
                  dot={false}
                  strokeWidth={2.2}
                />
              )}
              {config.assets.map((asset, index) => (
                <Line
                  key={asset.id}
                  type="monotone"
                  dataKey={asset.id}
                  name={asset.label}
                  stroke={QUOTE_COLORS[index % QUOTE_COLORS.length]}
                  dot={false}
                  strokeWidth={1.6}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <div className="flex h-full items-center justify-center text-[11px] text-muted-foreground">
            {mode === "value" && Object.keys(holdings).length === 0
              ? "Bestand fehlt – Kennzahl verbinden oder unten eintragen"
              : "Noch keine Kursdaten – „Kurse“ klicken"}
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-1.5 text-[10px] text-muted-foreground">
        {config.assets.map((asset, index) => (
          <span key={asset.id} className="flex items-center gap-1">
            <span
              className="inline-block size-2 rounded-full"
              style={{ background: QUOTE_COLORS[index % QUOTE_COLORS.length] }}
            />
            {asset.label}
            <span className="font-mono">{formatPrice(latestPrice(config, asset.id), config.currency)}</span>
            {holdings[asset.id] ? (
              <span className="font-mono opacity-80">
                × {holdings[asset.id]!.toLocaleString("de-DE")} ={" "}
                {formatPrice(holdings[asset.id]! * (latestPrice(config, asset.id) ?? 0), config.currency)}
              </span>
            ) : null}
          </span>
        ))}
      </div>

      {selected && (
        <div className="nowheel max-h-28 shrink-0 overflow-auto border-t px-3 py-1.5">
          <p className="mb-1 text-[10px] text-muted-foreground">
            Bestand je Wert – leer lassen, wenn eine verbundene Kennzahl den Bestand liefert.
          </p>
          <div className="grid grid-cols-2 gap-1">
            {config.assets.map((asset) => (
              <label key={asset.id} className="flex items-center gap-1 text-[10px]">
                <span className="w-16 shrink-0 truncate">{asset.label}</span>
                <input
                  defaultValue={manual[asset.id] != null ? String(manual[asset.id]) : ""}
                  placeholder={linked[asset.id] ? `${linked[asset.id]!.amount}` : "0"}
                  aria-label={`Bestand ${asset.label}`}
                  className="nodrag h-6 min-w-0 flex-1 rounded-md border border-border/70 bg-background px-1 text-right font-mono text-[10px] outline-none"
                  onBlur={(e) => {
                    const next = { ...manual };
                    const num = Number(e.target.value.replace(",", "."));
                    if (e.target.value.trim() && Number.isFinite(num)) next[asset.id] = num;
                    else delete next[asset.id];
                    patch({ holdings: next });
                  }}
                />
              </label>
            ))}
          </div>
        </div>
      )}


      <div className="nowheel flex-1 overflow-auto border-t px-3 py-2 text-[11px]">
        <div className="mb-1 flex items-center justify-between">
          <span className="font-medium">Entscheidungen im Rückblick</span>
          {rate !== null && (
            <span className="text-muted-foreground">Trefferquote {Math.round(rate * 100)} %</span>
          )}
        </div>
        {results.some((item) => item.pending) && (
          <p className="mb-1 text-[10px] text-muted-foreground">
            „offen“ heißt: seit dem Festhalten gibt es noch keine neueren Kurse. Später erneut auf
            „Kurse“ klicken – dann wird verglichen.
          </p>
        )}
        {results.length === 0 ? (
          <p className="text-muted-foreground">
            Noch nichts festgehalten. Mit dem Entscheidungs-Modul verbinden und „Entscheidung festhalten“ klicken.
          </p>
        ) : (
          <ul className="space-y-1">
            {results.map((item, index) => (
              <li key={`${item.at}-${item.asset}-${index}`} className="flex items-center justify-between gap-2">
                <span className="min-w-0 truncate">
                  <span
                    className="mr-1 font-medium"
                    style={{ color: item.buy ? "var(--ok, #16a34a)" : "var(--danger, #dc2626)" }}
                  >
                    {item.buy ? "KAUFEN" : "NICHT KAUFEN"}
                  </span>
                  {" "}{item.label} ·{" "}
                  {new Date(item.at).toLocaleString("de-DE", {
                    day: "2-digit",
                    month: "2-digit",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}{" "}
                  · {formatPrice(item.price, config.currency)}
                </span>
                <span className="shrink-0 font-mono">
                  {item.pending
                    ? "offen"
                    : item.changePct === null
                      ? "–"
                      : `${item.changePct > 0 ? "+" : ""}${item.changePct.toFixed(2)} %`}{" "}
                  {item.correct === null ? "" : item.correct ? "✓" : "✗"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex items-center justify-between gap-2 border-t px-2 py-1.5 text-[10px] text-muted-foreground">
        <span>
          {config.lastAt
            ? `Stand ${new Date(config.lastAt).toLocaleString("de-DE", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}`
            : "Noch kein Abruf"}
        </span>
        <div className="flex items-center gap-1">
          {config.marks.length > 0 && (
            <button
              type="button"
              className="nodrag rounded-full px-2 py-0.5 hover:bg-accent"
              onClick={() => patch({ marks: [] })}
            >
              Verlauf leeren
            </button>
          )}
          <Button
            size="sm"
            variant="secondary"
            className="nodrag h-7 rounded-full px-2 text-[11px]"
            disabled={busy}
            onClick={() => void recordDecisions()}
          >
            Entscheidung festhalten
          </Button>
        </div>
      </div>
    </div>
  );
});

const LeafletMap = lazy(() => import("@/components/canvas/LeafletMap"));

/** Map module: geocoded objects from a connected table plus a weather layer. */
export const MapNode = memo(function MapNode({ id, data, selected }: NodeProps) {
  const record = (data as unknown as Data).record;
  const { updateNode } = useBoard();
  const edges = useEdges();
  const flowNodes = useStore((state) => state.nodes);
  const [busy, setBusy] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  const config = readMapConfig(record);

  const sources = useMemo(() => {
    const byId = Object.fromEntries(
      flowNodes.map((n) => [n.id, (n.data as { record: NodeRecord }).record]),
    ) as Record<string, NodeRecord>;
    return edges
      .filter((edge) => edge.target === id || edge.source === id)
      .map((edge) => byId[edge.target === id ? edge.source : edge.target])
      .filter((item): item is NodeRecord => Boolean(item));
  }, [edges, flowNodes, id]);

  const points = useMemo(() => pointsFromSources(sources, config), [sources, config]);
  const summary = useMemo(() => mapText(points, config.weather), [points, config.weather]);

  // keep the chat / decision context in sync with what the map shows
  useEffect(() => {
    if (summary && summary !== record.content) updateNode(record.id, { content: summary });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [summary]);

  function patch(next: Record<string, unknown>) {
    updateNode(record.id, { metadata: { ...(record.metadata ?? {}), ...next } });
  }

  async function loadWeather() {
    if (!points.length) {
      toast.error("Keine Objekte – erst eine Tabelle mit Koordinaten verbinden");
      return;
    }
    setBusy(true);
    try {
      const batch = points.slice(0, 50);
      const answer = await runApiModule({
        data: {
          url: "https://api.open-meteo.com/v1/forecast",
          method: "GET",
          params: [
            { key: "latitude", value: batch.map((point) => point.lat.toFixed(4)).join(",") },
            { key: "longitude", value: batch.map((point) => point.lon.toFixed(4)).join(",") },
            { key: "current", value: "precipitation,wind_speed_10m,temperature_2m" },
          ],
          headers: [],
        },
      });
      if (answer.status !== 200) throw new Error(`Wetter: Status ${answer.status}`);
      const parsed = JSON.parse(answer.body) as
        | { current?: Record<string, number> }
        | { current?: Record<string, number> }[];
      const list = Array.isArray(parsed) ? parsed : [parsed];
      const weather: Record<string, unknown> = {};
      batch.forEach((point, index) => {
        const current = list[index]?.current ?? {};
        weather[point.id] = {
          rain: Number(current["precipitation"] ?? NaN),
          wind: Number(current["wind_speed_10m"] ?? NaN),
          temp: Number(current["temperature_2m"] ?? NaN),
        };
      });
      patch({ weather, lastAt: new Date().toISOString() });
      toast.success("Wetter aktualisiert");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Wetter konnte nicht geladen werden");
    } finally {
      setBusy(false);
    }
  }

  const center: [number, number] = points.length
    ? [
        points.reduce((sum, point) => sum + point.lat, 0) / points.length,
        points.reduce((sum, point) => sum + point.lon, 0) / points.length,
      ]
    : config.center;

  const risky = points.filter((point) => (config.weather[point.id]?.rain ?? 0) >= 10).length;

  return (
    <div
      className={`flex h-full w-full flex-col overflow-hidden rounded-lg border bg-card shadow-[var(--shadow-card)] ${
        selected ? "border-ring/60 shadow-[var(--shadow-float)]" : "border-border/70"
      }`}
    >
      <NodeResizer isVisible={Boolean(selected)} minWidth={320} minHeight={280} />
      <Handle type="target" position={Position.Left} />
      <Handle type="target" position={Position.Top} />
      <Handle type="source" position={Position.Right} />
      <Handle type="source" position={Position.Bottom} />

      <div className="flex items-center gap-2 border-b px-3 py-1.5">
        <input
          key={record.id + (record.title ?? "")}
          defaultValue={record.title ?? "Karte"}
          className="nodrag min-w-0 flex-1 bg-transparent text-sm font-medium outline-none"
          onBlur={(e) => updateNode(record.id, { title: e.target.value.trim() || "Karte" })}
        />
        <Button
          size="sm"
          variant="secondary"
          className="nodrag h-7 rounded-full px-2 text-[11px]"
          disabled={busy}
          onClick={() => void loadWeather()}
        >
          <RefreshCw className={`size-3 ${busy ? "animate-spin" : ""}`} /> Wetter holen
        </Button>
      </div>

      <div className="relative flex-1">
        <ClientOnly
          fallback={
            <div className="flex h-full items-center justify-center text-[11px] text-muted-foreground">
              Karte wird geladen …
            </div>
          }
        >
          <Suspense
            fallback={
              <div className="flex h-full items-center justify-center text-[11px] text-muted-foreground">
                Karte wird geladen …
              </div>
            }
          >
            <LeafletMap
              points={points}
              weather={config.weather}
              center={center}
              zoom={points.length ? 6 : config.zoom}
              selectedId={picked}
              onSelect={setPicked}
            />
          </Suspense>
        </ClientOnly>
        {!points.length && (
          <div className="pointer-events-none absolute inset-x-3 bottom-3 rounded-md bg-card/90 px-2 py-1 text-[10px] text-muted-foreground">
            Keine Objekte – eine Tabelle mit Spalten für Breitengrad und Längengrad verbinden.
          </div>
        )}
      </div>

      <div className="flex items-center justify-between gap-2 border-t px-3 py-1.5 text-[10px] text-muted-foreground">
        <span>
          {points.length} Objekte · {risky} mit starkem Regen
        </span>
        <span>{config.lastAt ? new Date(config.lastAt).toLocaleString("de-DE") : "kein Abruf"}</span>
      </div>

      {picked && (
        <div className="border-t px-3 py-1.5 text-[11px]">
          {(() => {
            const point = points.find((item) => item.id === picked);
            if (!point) return null;
            const w = config.weather[point.id];
            return (
              <span>
                <strong>{point.label}</strong>
                {point.klass ? ` · ${point.klass}` : ""} ·{" "}
                {w ? `Regen ${w.rain ?? "?"} mm/h, Wind ${w.wind ?? "?"} km/h` : "kein Wetter"}
              </span>
            );
          })()}
        </div>
      )}
    </div>
  );
});

/** Risk map: objects of a connected map plotted over likelihood × impact. */
export const RiskNode = memo(function RiskNode({ id, data, selected }: NodeProps) {
  const record = (data as unknown as Data).record;
  const { updateNode } = useBoard();
  const edges = useEdges();
  const flowNodes = useStore((state) => state.nodes);
  const config = readRiskConfig(record);

  const maps = useMemo(() => {
    const byId = Object.fromEntries(
      flowNodes.map((n) => [n.id, (n.data as { record: NodeRecord }).record]),
    ) as Record<string, NodeRecord>;
    const connected = edges
      .filter((edge) => edge.target === id || edge.source === id)
      .map((edge) => byId[edge.target === id ? edge.source : edge.target])
      .filter((item): item is NodeRecord => Boolean(item) && item?.type === "map");
    if (connected.length) return { maps: connected, records: byId };
    return { maps: Object.values(byId).filter((item) => item?.type === "map"), records: byId };
  }, [edges, flowNodes, id]);

  const { entries, weather } = useMemo(() => {
    const all: RiskEntry[] = [];
    const seen: Record<string, { rain: number | null; wind: number | null; temp: number | null }> =
      {};
    for (const mapRecord of maps.maps) {
      const mapConfig = readMapConfig(mapRecord);
      const sources = edges
        .filter((edge) => edge.target === mapRecord.id || edge.source === mapRecord.id)
        .map((edge) =>
          maps.records[edge.target === mapRecord.id ? edge.source : edge.target],
        )
        .filter((item): item is NodeRecord => Boolean(item));
      const points = pointsFromSources(sources, mapConfig);
      Object.assign(seen, mapConfig.weather);
      all.push(...riskEntries(points, mapConfig.weather, config));
    }
    return { entries: all, weather: seen };
  }, [maps, edges, config]);

  /** Decision modules this risk map feeds. */
  const feeds = useMemo(
    () =>
      edges
        .filter((edge) => edge.source === id)
        .map((edge) => maps.records[edge.target])
        .filter((item): item is NodeRecord => item?.type === "decision"),
    [edges, maps, id],
  );

  const summary = useMemo(() => riskText(entries), [entries]);
  useEffect(() => {
    if (summary && summary !== record.content) updateNode(record.id, { content: summary });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [summary]);

  function patch(next: Record<string, unknown>) {
    updateNode(record.id, { metadata: { ...(record.metadata ?? {}), ...next } });
  }

  const highest = maxRisk(entries);
  const counts = [1, 2, 3, 4, 5].map(
    (level) => entries.filter((entry) => entry.level === level).length,
  );

  return (
    <div
      className={`flex h-full w-full flex-col overflow-hidden rounded-lg border bg-card shadow-[var(--shadow-card)] ${
        selected ? "border-ring/60 shadow-[var(--shadow-float)]" : "border-border/70"
      }`}
    >
      <NodeResizer isVisible={Boolean(selected)} minWidth={300} minHeight={280} />
      <Handle type="target" position={Position.Left} />
      <Handle type="target" position={Position.Top} />
      <Handle type="source" position={Position.Right} />
      <Handle type="source" position={Position.Bottom} />

      <div className="flex items-center gap-2 border-b px-3 py-1.5">
        <input
          key={record.id + (record.title ?? "")}
          defaultValue={record.title ?? "Risikokarte"}
          className="nodrag min-w-0 flex-1 bg-transparent text-sm font-medium outline-none"
          onBlur={(e) => updateNode(record.id, { title: e.target.value.trim() || "Risikokarte" })}
        />
        <span className="shrink-0 text-[10px] text-muted-foreground">
          höchste Stufe {highest ?? "–"}
          {highest ? ` · ${RISK_LABEL[highest]}` : ""}
        </span>
      </div>

      <div className="nowheel flex-1 overflow-auto p-2">
        <div className="flex gap-1">
          <div className="flex w-4 items-center justify-center">
            <span className="rotate-180 text-[9px] text-muted-foreground [writing-mode:vertical-rl]">
              Auswirkung
            </span>
          </div>
          <div className="grid flex-1 grid-cols-5 gap-1">
            {[5, 4, 3, 2, 1].map((impact) =>
              [1, 2, 3, 4, 5].map((chance) => {
                const cell = entries.filter(
                  (entry) => entry.impact === impact && entry.likelihood === chance,
                );
                return (
                  <div
                    key={`${impact}-${chance}`}
                    title={cell.map((entry) => entry.point.label).join(", ")}
                    className="flex min-h-9 flex-wrap items-center justify-center gap-0.5 rounded-md p-1"
                    style={{ background: riskColor(chance, impact), opacity: cell.length ? 1 : 0.35 }}
                  >
                    {cell.slice(0, 6).map((entry) => (
                      <span
                        key={entry.point.id}
                        className="size-2 rounded-full bg-white/90"
                        aria-label={entry.point.label}
                      />
                    ))}
                    {cell.length > 6 && (
                      <span className="text-[9px] font-medium text-white">+{cell.length - 6}</span>
                    )}
                  </div>
                );
              }),
            )}
          </div>
        </div>
        <p className="mt-1 pl-5 text-center text-[9px] text-muted-foreground">
          Eintrittswahrscheinlichkeit (Wetterlage) →
        </p>

        <div className="mt-1.5 flex flex-wrap gap-x-2 gap-y-0.5 text-[10px] text-muted-foreground">
          {counts.map((count, index) => (
            <span key={index}>
              Stufe {index + 1}: {count}
            </span>
          ))}
        </div>

        {!entries.length && (
          <p className="mt-2 text-[11px] text-muted-foreground">
            Keine Objekte – mit einem Karten-Modul verbinden und dort „Wetter holen“ klicken.
          </p>
        )}

        {selected && (
          <div className="mt-2 grid grid-cols-2 gap-1 border-t pt-2 text-[10px]">
            {(
              [
                ["rainWarn", "Regen Warnung mm/h"],
                ["rainDanger", "Regen Gefahr mm/h"],
                ["windWarn", "Wind Warnung km/h"],
                ["windDanger", "Wind Gefahr km/h"],
                ["defaultImpact", "Auswirkung Standard 1–5"],
              ] as const
            ).map(([key, label]) => (
              <label key={key} className="flex items-center gap-1">
                <span className="min-w-0 flex-1 truncate">{label}</span>
                <input
                  defaultValue={String(config[key])}
                  aria-label={label}
                  className="nodrag h-6 w-14 rounded-md border border-border/70 bg-background px-1 text-right font-mono text-[10px] outline-none"
                  onBlur={(e) => {
                    const value = Number(e.target.value.replace(",", "."));
                    if (Number.isFinite(value)) patch({ [key]: value });
                  }}
                />
              </label>
            ))}
          </div>
        )}
      </div>
    </div>
  );
});
