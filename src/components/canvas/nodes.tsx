import { Fragment, lazy, memo, Suspense, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { ClientOnly } from "@tanstack/react-router";
import {
  mapText,
  pointsFromSources,
  readMapConfig,
  type GeoPoint,
  type WeatherValue,
} from "@/lib/geo";
import {
  CHANGE_LABEL,
  IMPACT_LABEL,
  LIKELIHOOD_LABEL,
  RISK_CLASSES,
  ageChance,
  evaluate,
  explainScore,
  isoText,
  measureOf,
  readIsoRisk,
  scoreColor,
  weatherChance,
  type RiskChange,
  type RiskField,
} from "@/lib/iso-risk";
import { clearMapFocus, setMapFocus, useMapFocus } from "@/lib/map-focus";

import { Plug } from "lucide-react";
import { AlertTriangle, BookOpen, Calculator, Camera, ChevronDown, ChevronRight, ChevronUp, CloudSun, ExternalLink, Eye, EyeOff, Globe, ImagePlus, LayoutTemplate, Lock, Plus, RefreshCw, RotateCcw, RotateCw, Scale, ShieldOff, Sparkles, Trash2, X } from "lucide-react";
import {
  BaseEdge,
  EdgeLabelRenderer,
  Handle,
  NodeResizer,
  Position,
  getSmoothStepPath,
  useReactFlow,
  useEdges,
  useNodeId,
  useStore,
  type EdgeProps,
  type NodeProps,
} from "@xyflow/react";
import { calcInputs, edgeValue, evalFormula, formatValue, nodeValue, readFormat, sheetOutputRow, sheetRows, sheetValues, valueOfNode } from "@/lib/calc";
import { useEdgeLabelsVisible } from "@/lib/edge-labels";
import { Markdown, markdownSections } from "@/lib/markdown";
import { edgeProblem, isReference, type PortStatus as SignalPortStatus } from "@/lib/signal-status";
import { APP_DESIGN_PRESETS, readAgent, readAppBranding, readAppLayout, readAssignment, zoneMembers, type AppAccent, type AppBackground, type AppBranding, type AppDesignProfile, type AppLayoutEntry } from "@/lib/zones";
import {
  factorText,
  normalizeWeights,
  paramsFromText,
  levelOf,
  readFactor,
  readThemeWeight,
  themeIndex,
  type FactorParam,
  type ThemeScore,
} from "@/lib/factor-score";
import { suggestFactorWeights } from "@/lib/factor.functions";
import { runApiModule } from "@/lib/api-module.functions";
import { listMcpServers, refreshMcpServer } from "@/lib/mcp-client.functions";
import { mcpPreview, mcpValue, readMcp, readMcpHistory } from "@/lib/mcp-module";
import { argsFromInputs, missingRequired, schemaFields, suggestPaths } from "@/lib/mcp-schema";
import { McpConnectDialog } from "./mcp-connect-dialog";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { analyzeInspection } from "@/lib/inspection.functions";
import {
  CLUSTERS,
  STATUS_COLOR,
  STATUS_VALUES,
  downscale,
  euro,
  exifLocation,
  inspectionText,
  isOverdue,
  labelFromFile,
  priorityColor,
  rateFor,
  readInspection,
  totalCost,
  type Finding,
} from "@/lib/inspection";
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

type PortStatus = SignalPortStatus;

const NUM = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 2 });

/**
 * Connection point with a discreet status light:
 * green = value flows, amber = waiting for a value, red = invalid calculation.
 */


function SignalHandle(props: React.ComponentProps<typeof Handle>) {
  const nodeId = useNodeId();
  const kind = props.type;
  const state = useStore(
    (store) => {
      const empty = { status: "idle" as PortStatus, hint: "", text: "" };
      if (!nodeId) return empty;
      const records: Record<string, NodeRecord> = {};
      for (const [id, item] of store.nodeLookup) {
        const record = (item.data as Data | undefined)?.record;
        if (record) records[id] = record;
      }
      const edges = store.edges;
      const valueOf = (id: string) => {
        const record = records[id];
        return record ? valueOfNode(record, records, edges) : null;
      };
      const own = records[nodeId];
      if (kind === "source") {
        const linked = edges.some((edge) => edge.source === nodeId);
        if (!linked) return empty;
        const value = valueOf(nodeId);
        if (value == null) {
          if (isReference(own))
            return { status: "idle" as PortStatus, hint: "Ausgang: Inhalt (ohne Zahlenwert)", text: "" };
          return { status: "warn" as PortStatus, hint: "Ausgang: noch kein Wert", text: "" };
        }
        const text = formatValue(value, readFormat(own?.metadata));
        return { status: "ok" as PortStatus, hint: `Ausgang: ${text}`, text };
      }
      const incoming = edges.filter((edge) => edge.target === nodeId);
      if (!incoming.length) return empty;
      let status: PortStatus = "idle";
      const parts: string[] = [];
      for (const edge of incoming) {
        const source = records[edge.source];
        const raw = valueOf(edge.source);
        const label = typeof edge.label === "string" ? edge.label : "";
        const result = edgeValue(label, raw);
        if (raw != null && result == null) {
          status = "error";
          parts.push(`${source?.title ?? "Quelle"}: Rechnung ungültig`);
        } else if (raw == null) {
          if (isReference(source)) {
            parts.push(`${source?.title ?? "Quelle"}: Inhalt`);
          } else {
            if (status !== "error") status = "warn";
            parts.push(`${source?.title ?? "Quelle"}: kein Wert`);
          }
        } else {
          if (status === "idle") status = "ok";
          parts.push(`${source?.title ?? "Quelle"}: ${NUM.format(result!)}`);
        }
      }
      return { status, hint: `Eingang · ${parts.join(" · ")}`, text: "" };
    },
    (a, b) => a.status === b.status && a.hint === b.hint && a.text === b.text,
  );
  const showValue =
    kind === "source" && state.status === "ok" && state.text && props.position === Position.Right;
  return (
    <>
      <Handle
        {...props}
        data-status={state.status}
        {...(state.hint ? { title: state.hint } : {})}
      />
      {showValue ? (
        <span
          className="port-value pointer-events-none absolute font-mono"
          style={{ right: -12, top: "50%", transform: "translate(100%, -50%)" }}
        >
          {state.text}
        </span>
      ) : null}
    </>
  );
}

/** Alle direkt verbundenen Karten (beide Richtungen), stabil sortiert. */
function useConnectedRecords(nodeId: string): NodeRecord[] {
  return useStore(
    (store) => {
      const linked: NodeRecord[] = [];
      const seen = new Set<string>();
      for (const edge of store.edges) {
        const otherId =
          edge.source === nodeId ? edge.target : edge.target === nodeId ? edge.source : null;
        if (!otherId || seen.has(otherId)) continue;
        seen.add(otherId);
        const record = (store.nodeLookup.get(otherId)?.data as Data | undefined)?.record;
        if (record) linked.push(record);
      }
      return linked.sort((a, b) => (a.title ?? "").localeCompare(b.title ?? ""));
    },
    (a, b) =>
      a.length === b.length &&
      a.every((item, index) => item.id === b[index]?.id && item.content === b[index]?.content),
  );
}

/** Verbundene Textkarten mit Inhalt – sie dienen als Kontext für MCP-Karten. */
function contextCards(linked: NodeRecord[]): NodeRecord[] {
  return linked.filter((item) => item.type === "text" && (item.content ?? "").trim());
}



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
      {!locked && <SignalHandle type="target" position={Position.Left} />}
      <div
        className="module-card flex h-full w-full flex-col overflow-hidden border bg-card"
        data-selected={Boolean(selected)}
        style={{ borderTop: `3px solid ${NODE_ACCENT[type] ?? "var(--primary)"}` }}
      >
        {children}
      </div>
      {!locked && <SignalHandle type="source" position={Position.Right} />}
    </>
  );
}

function Header({ record }: { record: NodeRecord }) {
  const { deleteNode, zoneOf, openInspector } = useBoard();
  const zone = zoneOf(record.id);
  return (
    <div className="module-heading border-b px-3 py-2">
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

type NoteRole = {
  eyebrow: string;
  state: string;
  tone: "risk" | "likelihood" | "impact" | "evidence" | "reference";
};

/** Notes on an assessment board are typed evidence, not passive prose. */
function noteRole(record: NodeRecord): NoteRole {
  const title = (record.title ?? "").toLocaleLowerCase("de-DE");
  if (title.startsWith("eintritt:")) {
    return { eyebrow: "Eintrittswahrscheinlichkeit", state: "EVIDENZ", tone: "likelihood" };
  }
  if (title.startsWith("auswirkung:")) {
    return { eyebrow: "Auswirkungsnachweis", state: "EVIDENZ", tone: "impact" };
  }
  if (title.includes("befund")) {
    return { eyebrow: "Prüfgrundlage", state: "VALIDIERUNG", tone: "evidence" };
  }
  if (title.includes("legende") || title.includes("risikoklasse")) {
    return { eyebrow: "Bewertungsregel", state: "REFERENZ", tone: "reference" };
  }
  if (/^\d+[.)]/.test(title) || title.includes("risiko")) {
    return { eyebrow: "Risikotreiber", state: "RISIKO", tone: "risk" };
  }
  return { eyebrow: "Fachlicher Eintrag", state: "EINGANG", tone: "evidence" };
}

const NOTE_TONE: Record<NoteRole["tone"], string> = {
  risk: "bg-destructive/8 text-destructive",
  likelihood: "bg-note/12 text-foreground",
  impact: "bg-video/10 text-foreground",
  evidence: "bg-doc/10 text-foreground",
  reference: "bg-secondary text-muted-foreground",
};

/** Extracts a leading metric ("Anteil > 25 Jahre: 41,7 %") from evidence text. */
function firstNumber(text: string): number | null {
  const hit = text.replace(/\s/g, "").match(/-?\d+(?:[.,]\d+)?/);
  if (!hit) return null;
  return Number.parseFloat(hit[0].replace(",", "."));
}

function noteKpi(entries: string[]) {
  const metricIndex = entries.findIndex(
    (entry) => entry.includes(":") && firstNumber(entry.split(":").slice(1).join(":")) !== null,
  );
  if (metricIndex < 0) return null;
  const [rawLabel = "", ...rest] = (entries[metricIndex] ?? "").split(":");
  const value = rest.join(":").trim();
  const limitEntry = entries.find((entry, index) =>
    index !== metricIndex && /schwelle|limit|grenzwert|ziel/i.test(entry),
  );
  const valueNumber = firstNumber(value);
  const limitNumber = limitEntry ? firstNumber(limitEntry.split(":").slice(1).join(":") || limitEntry) : null;
  const breach = valueNumber !== null && limitNumber !== null ? valueNumber >= limitNumber : null;
  return {
    label: rawLabel.trim(),
    value,
    caption: limitEntry ?? null,
    breach,
    rest: entries.filter((_, index) => index !== metricIndex && entries[index] !== limitEntry),
  };
}

export const NoteNode = memo(function NoteNode({ data, selected }: NodeProps) {
  const record = (data as unknown as Data).record;
  const { updateNode } = useBoard();
  const [text, setText] = useState(record.content ?? "");
  const [busy, setBusy] = useState(false);
  const role = noteRole(record);
  const entries = text
    .split("\n")
    .map((entry) => entry.trim())
    .filter(Boolean);
  const kpi = noteKpi(entries);
  const listEntries = kpi ? kpi.rest : entries;
  const factor = readFactor(record);

  useEffect(() => setText(record.content ?? ""), [record.content]);

  function saveParams(next: FactorParam[]) {
    updateNode(record.id, { metadata: { ...(record.metadata ?? {}), params: next } });
  }

  function patchParam(id: string, change: Partial<FactorParam>) {
    saveParams(factor.params.map((param) => (param.id === id ? { ...param, ...change } : param)));
  }

  async function askForWeights() {
    if (!factor.params.length) return;
    setBusy(true);
    try {
      const result = await suggestFactorWeights({
        data: {
          title: record.title ?? "Faktor",
          context: record.content ?? "",
          params: factor.params.map((param) => ({
            label: param.label,
            weight: param.weight,
            score: param.score,
          })),
        },
      });
      const next = factor.params.map((param, index) => {
        const hit = result.params[index];
        if (!hit) return param;
        return {
          ...param,
          weight: Math.max(0, Math.min(100, Math.round(hit.weight * 10) / 10)),
          score: Math.max(1, Math.min(10, Math.round(hit.score * 2) / 2)),
          source: "JEV-Vorschlag",
        };
      });
      saveParams(normalizeWeights(next));
      toast.success("Gewichtung vorgeschlagen", { description: result.reason });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Gewichtung fehlgeschlagen");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Shell type="note" selected={selected} locked={Boolean(record.parent_id)}>
      <Header record={record} />
      <div className={`flex items-center justify-between border-b px-3 py-2 ${NOTE_TONE[role.tone]}`}>
        <span className="module-eyebrow text-current">{role.eyebrow}</span>
        <span className="rounded-sm border border-current/20 px-1.5 py-0.5 font-mono text-[9px] font-semibold">
          {role.state}
        </span>
      </div>

      {factor.params.length > 0 && (
        <div className="border-b px-3 py-2.5">
          <div className="flex items-end justify-between gap-2">
            <div className="min-w-0">
              <div className="module-eyebrow">Gewichteter Faktorwert</div>
              <div className="kpi-value mt-0.5">{factor.score.toFixed(1)} / 10</div>
            </div>
            <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
              Stufe {factor.level} / 5
            </span>
          </div>
          <span
            className="kpi-bar mt-2"
            style={{
              width: `${Math.max(4, factor.score * 10)}%`,
              background: factor.score >= 6 ? "var(--destructive)" : "var(--note)",
            }}
          />
          <div className="module-eyebrow mt-2 normal-case tracking-normal">
            {factor.params.length} Parameter · Summe {factor.weightSum} %
            {factor.balanced ? "" : " (nicht 100 %)"}
            {factor.stored ? "" : " · aus Text abgeleitet"}
          </div>
        </div>
      )}

      {selected ? (
        <div className="flex min-h-0 flex-1 flex-col">
          <>
            <Textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              onBlur={() => text !== record.content && updateNode(record.id, { content: text })}
              placeholder="Faktor schreiben …"
              className="nodrag nowheel h-full flex-1 resize-none rounded-none border-0 bg-transparent text-xs focus-visible:ring-0"
            />
            <div className="module-eyebrow border-t px-2 pt-1.5">Gewichtung</div>
            <div className="nowheel min-h-0 flex-1 overflow-auto p-2">
              {factor.params.length === 0 ? (
                <p className="px-1 py-2 text-[11px] text-muted-foreground">
                  Noch keine Parameter. Schreiben Sie je Zeile einen Parameter in den Text.
                </p>
              ) : (
                <table className="w-full table-fixed border-collapse text-[10px]">
                  <thead>
                    <tr className="text-muted-foreground">
                      <th className="px-1 py-1 text-left font-medium">Parameter</th>
                      <th className="w-12 px-1 py-1 text-right font-medium">%</th>
                      <th className="w-12 px-1 py-1 text-right font-medium">1–10</th>
                      <th className="w-10 px-1 py-1 text-right font-medium">Anteil</th>
                      <th className="w-4" />
                    </tr>
                  </thead>
                  <tbody>
                    {factor.params.map((param) => (
                      <tr key={param.id} className="border-t border-border/60">
                        <td className="px-1 py-1">
                          <input
                            defaultValue={param.label}
                            aria-label="Parameter"
                            className="nodrag h-5 w-full rounded border border-transparent bg-transparent outline-none hover:border-border focus:border-ring"
                            onBlur={(e) => patchParam(param.id, { label: e.target.value.trim() })}
                          />
                        </td>
                        <td className="px-1 py-1">
                          <input
                            type="number"
                            min={0}
                            max={100}
                            step={0.5}
                            defaultValue={param.weight}
                            aria-label={`Gewicht ${param.label}`}
                            className="nodrag h-5 w-full rounded border border-transparent bg-transparent text-right font-mono tabular-nums outline-none hover:border-border focus:border-ring"
                            onBlur={(e) => patchParam(param.id, { weight: Number(e.target.value) })}
                          />
                        </td>
                        <td className="px-1 py-1">
                          <input
                            type="number"
                            min={1}
                            max={10}
                            step={0.5}
                            defaultValue={param.score}
                            aria-label={`Zustand ${param.label}`}
                            className="nodrag h-5 w-full rounded border border-transparent bg-transparent text-right font-mono tabular-nums outline-none hover:border-border focus:border-ring"
                            onBlur={(e) => patchParam(param.id, { score: Number(e.target.value) })}
                          />
                        </td>
                        <td className="px-1 py-1 text-right font-mono tabular-nums text-muted-foreground">
                          {((param.weight * param.score) / 100).toFixed(2)}
                        </td>
                        <td className="px-1 py-1 text-right">
                          <button
                            type="button"
                            aria-label="Parameter entfernen"
                            className="nodrag text-muted-foreground hover:text-destructive"
                            onClick={() =>
                              saveParams(factor.params.filter((item) => item.id !== param.id))
                            }
                          >
                            ✕
                          </button>
                        </td>
                      </tr>
                    ))}
                    <tr className="border-t-2 border-border font-medium">
                      <td className="px-1 py-1">Summe</td>
                      <td
                        className={`px-1 py-1 text-right font-mono tabular-nums ${
                          factor.balanced ? "text-foreground" : "text-destructive"
                        }`}
                      >
                        {factor.weightSum}
                      </td>
                      <td className="px-1 py-1 text-right font-mono tabular-nums" colSpan={2}>
                        {factor.score.toFixed(1)} / 10
                      </td>
                      <td />
                    </tr>
                  </tbody>
                </table>
              )}
              <div className="mt-2 flex flex-wrap gap-1">
                <button
                  type="button"
                  className="nodrag rounded-full border border-border/70 px-2 py-0.5 text-[10px] hover:bg-accent"
                  onClick={() =>
                    saveParams([
                      ...factor.params,
                      {
                        id: `p${Date.now()}`,
                        label: "Neuer Parameter",
                        weight: 0,
                        score: 5,
                        source: "manuell",
                      },
                    ])
                  }
                >
                  + Parameter
                </button>
                <button
                  type="button"
                  className="nodrag rounded-full border border-border/70 px-2 py-0.5 text-[10px] hover:bg-accent"
                  onClick={() => saveParams(normalizeWeights(factor.params))}
                >
                  Auf 100 % ausgleichen
                </button>
                <button
                  type="button"
                  className="nodrag rounded-full border border-border/70 px-2 py-0.5 text-[10px] hover:bg-accent"
                  onClick={() => saveParams(paramsFromText(record.content))}
                >
                  Aus Text übernehmen
                </button>
                <button
                  type="button"
                  disabled={busy || !factor.params.length}
                  className="nodrag rounded-full bg-primary px-2 py-0.5 text-[10px] text-primary-foreground disabled:opacity-50"
                  onClick={() => void askForWeights()}
                >
                  {busy ? "JEV rechnet …" : "Gewichtung mit JEV vorschlagen"}
                </button>
              </div>
            </div>
          </>
        </div>
      ) : (
        <div className="nowheel flex-1 overflow-auto">
          {kpi && !factor.params.length ? (
            <div className="border-b px-3 py-3">
              <div className="module-eyebrow">{kpi.label}</div>
              <div className="kpi-value mt-1">{kpi.value}</div>
              <span
                className="kpi-bar mt-2"
                style={{
                  background:
                    kpi.breach === null
                      ? "color-mix(in oklab, var(--foreground) 14%, transparent)"
                      : kpi.breach
                        ? "var(--destructive)"
                        : "var(--note)",
                }}
              />
              {kpi.caption ? (
                <div className="module-eyebrow mt-2 normal-case tracking-normal">{kpi.caption}</div>
              ) : null}
            </div>
          ) : null}
          <div className="px-3 py-2.5">
            {factor.params.length ? (
              <ul className="space-y-1.5" aria-label="Parameter">
                {factor.params.map((param) => (
                  <li key={param.id} className="flex items-center gap-2 text-xs leading-snug">
                    <span className="w-9 shrink-0 rounded-sm bg-secondary px-1 text-right font-mono text-[10px] tabular-nums">
                      {param.weight}%
                    </span>
                    <span className="min-w-0 flex-1 truncate">{param.label}</span>
                    <span
                      className={`shrink-0 font-mono text-[10px] tabular-nums ${
                        param.score >= 6 ? "text-destructive" : "text-muted-foreground"
                      }`}
                    >
                      {param.score}/10
                    </span>
                  </li>
                ))}
              </ul>
            ) : listEntries.length ? (
              <ul className="space-y-2" aria-label={role.eyebrow}>
                {listEntries.map((entry, index) => (
                  <li key={`${entry}-${index}`} className="flex gap-2 text-xs leading-snug text-foreground">
                    <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-note" />
                    <span>{entry}</span>
                  </li>
                ))}
              </ul>
            ) : kpi ? null : (
              <p className="text-xs text-muted-foreground">Noch kein fachlicher Eintrag</p>
            )}
          </div>
        </div>
      )}
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
      <SignalHandle type="target" position={Position.Left} />
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
      <SignalHandle type="source" position={Position.Right} />
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

const APP_ACCENTS: { id: AppAccent; label: string; swatch: string }[] = [
  { id: "forest", label: "Tiefgrün", swatch: "bg-brand-navy" },
  { id: "sage", label: "Salbei", swatch: "bg-brand-green" },
  { id: "terracotta", label: "Terrakotta", swatch: "bg-brand-orange" },
  { id: "cobalt", label: "Kobalt", swatch: "bg-app-cobalt" },
];

const APP_BACKGROUNDS: { id: AppBackground; label: string }[] = [
  { id: "stone", label: "Stein" },
  { id: "paper", label: "Papier" },
  { id: "grid", label: "Raster" },
];

export const ZoneNode = memo(function ZoneNode({ data, selected }: NodeProps) {
  const record = (data as unknown as Data).record;
  const { updateNode, resizeZone, runAgent, agentStale, openInspector, allNodes } = useBoard();
  const color = record.color ?? ZONE_WHITE;
  const meta = (record.metadata ?? {}) as Record<string, unknown>;
  const isGroup = meta["templateGroup"] === true;
  const locked = meta["locked"] === true;
  const agent = readAgent(record);
  const running = meta["agentRunning"] === true;
  const stale = agent ? agentStale(record.id) : false;
  const [designOpen, setDesignOpen] = useState(false);
  const [previewTitle, setPreviewTitle] = useState("");
  const [profileName, setProfileName] = useState("");
  const [customProfiles, setCustomProfiles] = useState<AppDesignProfile[]>([]);
  const logoInput = useRef<HTMLInputElement>(null);
  const branding = readAppBranding(record);
  useEffect(() => setPreviewTitle(branding.title), [record.id, branding.title]);
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem("canvas.appDesignProfiles");
      const parsed: unknown = raw ? JSON.parse(raw) : [];
      if (Array.isArray(parsed)) setCustomProfiles(parsed as AppDesignProfile[]);
    } catch {
      setCustomProfiles([]);
    }
  }, []);
  const members = useMemo(() => zoneMembers(record.id, allNodes()), [record.id, allNodes]);
  const layout = useMemo<AppLayoutEntry[]>(() => {
    const saved = readAppLayout(record) ?? [];
    const kept = saved.filter((entry) => members.some((m) => m.id === entry.id));
    const missing = members
      .filter((m) => !saved.some((entry) => entry.id === m.id))
      .map((m) => ({ id: m.id, view: "full" as const }));
    return [...kept, ...missing];
  }, [record, members]);
  const saveLayout = (entries: AppLayoutEntry[]) =>
    updateNode(record.id, { metadata: { ...(record.metadata ?? {}), appLayout: entries } });
  const saveBranding = (patch: Partial<AppBranding>) =>
    updateNode(record.id, {
      metadata: {
        ...(record.metadata ?? {}),
        appBranding: { ...branding, ...patch },
      },
    });
  const uploadLogo = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > 1024 * 1024) {
      toast.error("Das Logo darf höchstens 1 MB groß sein");
      return;
    }
    const isPng = file.type === "image/png" || file.name.toLowerCase().endsWith(".png");
    const isSvg = file.type === "image/svg+xml" || file.name.toLowerCase().endsWith(".svg");
    if (!isPng && !isSvg) {
      toast.error("Bitte ein PNG- oder SVG-Logo auswählen");
      return;
    }
    try {
      let logo = "";
      if (isSvg) {
        const source = await file.text();
        const documentNode = new DOMParser().parseFromString(source, "image/svg+xml");
        if (documentNode.querySelector("parsererror") || documentNode.documentElement.tagName.toLowerCase() !== "svg") {
          throw new Error("invalid svg");
        }
        documentNode.querySelectorAll("script, foreignObject, iframe, object, embed").forEach((node) => node.remove());
        documentNode.querySelectorAll("*").forEach((node) => {
          for (const attribute of [...node.attributes]) {
            const name = attribute.name.toLowerCase();
            const value = attribute.value.trim().toLowerCase();
            if (name.startsWith("on") || ((name === "href" || name.endsWith(":href")) && !value.startsWith("#") && value !== "")) {
              node.removeAttribute(attribute.name);
            }
          }
        });
        const clean = new XMLSerializer().serializeToString(documentNode.documentElement);
        logo = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(clean)}`;
      } else {
        logo = await downscale(file, 320, 0.9);
      }
      saveBranding({ logo });
    } catch {
      toast.error("Logo konnte nicht gelesen werden");
    }
  };
  const storeProfiles = (profiles: AppDesignProfile[]) => {
    setCustomProfiles(profiles);
    window.localStorage.setItem("canvas.appDesignProfiles", JSON.stringify(profiles));
  };
  const applyProfile = (profile: AppDesignProfile) => {
    const next = {
      ...profile.branding,
      title: profile.branding.title || branding.title,
      logo: profile.branding.logo || branding.logo,
    };
    setPreviewTitle(next.title);
    updateNode(record.id, { metadata: { ...(record.metadata ?? {}), appBranding: next } });
  };
  const saveProfile = () => {
    const name = profileName.trim();
    if (!name) {
      toast.error("Bitte einen Profilnamen eingeben");
      return;
    }
    const profile: AppDesignProfile = {
      id: globalThis.crypto?.randomUUID?.() ?? `profile-${Date.now()}`,
      name,
      branding: { ...branding, title: previewTitle.trim() },
      custom: true,
    };
    storeProfiles([...customProfiles, profile]);
    setProfileName("");
    toast.success("Designprofil gespeichert");
  };
  const moveEntry = (id: string, dir: -1 | 1) => {
    const next = [...layout];
    const from = next.findIndex((entry) => entry.id === id);
    const to = from + dir;
    if (from < 0 || to < 0 || to >= next.length) return;
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item!);
    saveLayout(next);
  };
  const patchEntry = (id: string, patch: Partial<AppLayoutEntry>) =>
    saveLayout(layout.map((entry) => (entry.id === id ? { ...entry, ...patch } : entry)));
  return (
    <>
      <NodeResizer
        minWidth={160}
        minHeight={120}
        isVisible={Boolean(selected) && !locked}
        color="var(--primary)"
        onResizeEnd={(_, params) => resizeZone(record.id, params.width, params.height)}
      />
      <SignalHandle type="target" position={Position.Left} className="!size-3" />
      <SignalHandle type="target" position={Position.Top} className="!size-3" />
      <SignalHandle type="source" position={Position.Right} className="!size-3" />
      <SignalHandle type="source" position={Position.Bottom} className="!size-3" />
      <div
        className={`relative h-full w-full overflow-hidden rounded-2xl border-2 shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--card)_70%,transparent)] transition-colors${isGroup ? " border-dashed" : ""}${selected ? " ring-2 ring-primary/35" : ""}`}
        style={{
          background: isGroup
            ? "transparent"
            : color === ZONE_WHITE
              ? "color-mix(in oklab, var(--brand-green) 5%, var(--card))"
              : `color-mix(in oklab, ${color} 12%, var(--card))`,
          borderColor:
            color === ZONE_WHITE
              ? "color-mix(in oklab, var(--brand-green-deep) 45%, var(--border))"
              : `color-mix(in oklab, ${color} 55%, var(--border))`,
        }}
      >
        <div className="flex min-h-11 items-center gap-2 border-b border-border/80 bg-card/90 pr-9 shadow-sm">
          <input
            defaultValue={record.title ?? "Feld"}
            readOnly={locked}
            onBlur={(e) => updateNode(record.id, { title: e.target.value })}
            className="nodrag min-w-0 flex-1 bg-transparent px-4 py-2.5 font-display text-sm font-semibold tracking-wide text-muted-foreground uppercase outline-none read-only:cursor-default"
          />
          <label className="nodrag flex shrink-0 items-center gap-1 rounded-full border border-border/70 bg-card/80 px-2 py-0.5">
            <span className="module-eyebrow">Gewicht</span>
            <input
              type="number"
              min={0}
              max={100}
              step={1}
              aria-label="Themengewicht in Prozent"
              defaultValue={readThemeWeight(record) || ""}
              placeholder="–"
              readOnly={locked}
              onBlur={(e) =>
                updateNode(record.id, {
                  metadata: { ...(record.metadata ?? {}), weight: Number(e.target.value) || 0 },
                })
              }
              className="w-9 bg-transparent text-right font-mono text-[10px] tabular-nums outline-none"
            />
            <span className="font-mono text-[10px] text-muted-foreground">%</span>
          </label>
          <UiTooltip>
            <TooltipTrigger asChild>
              <button
                aria-label="App-Ansicht gestalten"
                aria-pressed={designOpen}
                className={`nodrag shrink-0 rounded-md p-1 transition-colors hover:bg-accent hover:text-accent-foreground ${designOpen ? "text-primary" : "text-muted-foreground"}`}
                onClick={() => setDesignOpen((open) => !open)}
              >
                <LayoutTemplate className="size-3.5" />
              </button>
            </TooltipTrigger>
            <UiTooltipContent>App-Ansicht gestalten</UiTooltipContent>
          </UiTooltip>
          <UiTooltip>
            <TooltipTrigger asChild>
              <button
                aria-label="Feld als eigene App öffnen"
                className="nodrag mr-1 shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                onClick={() => {
                  const url = `${window.location.origin}/embed/zone/${record.id}`;
                  updateNode(record.id, {
                    metadata: { ...(record.metadata ?? {}), embed: true },
                  });
                  void navigator.clipboard?.writeText(url);
                  window.open(url, "_blank", "noopener");
                }}
              >
                <ExternalLink className="size-3.5" />
              </button>
            </TooltipTrigger>
            <UiTooltipContent>Als App öffnen (Link kopiert)</UiTooltipContent>
          </UiTooltip>
        </div>
        {designOpen && (
          <div className="nodrag absolute top-12 right-2 z-10 w-96 rounded-xl border border-border/70 bg-card/95 p-3 shadow-[var(--shadow-float)]">
            <div className="module-eyebrow pb-2 text-muted-foreground">App-Ansicht gestalten</div>
            <div className="space-y-2.5 border-b border-border/70 pb-3">
              <div>
                <span className="module-eyebrow mb-1.5 block">Designprofile</span>
                <div className="grid grid-cols-4 gap-1">
                  {APP_DESIGN_PRESETS.map((profile) => (
                    <button
                      key={profile.id}
                      type="button"
                      title={profile.name}
                      onClick={() => applyProfile(profile)}
                      className={`app-accent-${profile.branding.accent} app-background-${profile.branding.background} flex h-12 flex-col justify-end rounded-md border border-border/70 p-1.5 text-left hover:border-ring`}
                    >
                      <span className="app-logo-mark mb-auto size-2 rounded-sm" />
                      <span className="truncate text-[9px] font-semibold">{profile.name}</span>
                    </button>
                  ))}
                </div>
                {customProfiles.length > 0 && (
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {customProfiles.map((profile) => (
                      <div key={profile.id} className="flex items-center rounded-md border border-border/70 bg-secondary">
                        <button type="button" className="max-w-24 truncate px-2 py-1 text-[10px]" onClick={() => applyProfile(profile)}>{profile.name}</button>
                        <button type="button" aria-label={`${profile.name} löschen`} className="border-l border-border/70 p-1 text-muted-foreground hover:text-destructive" onClick={() => storeProfiles(customProfiles.filter((item) => item.id !== profile.id))}><X className="size-3" /></button>
                      </div>
                    ))}
                  </div>
                )}
                <div className="mt-1.5 flex gap-1">
                  <input aria-label="Name des Designprofils" value={profileName} onChange={(event) => setProfileName(event.target.value)} placeholder="Eigenes Profil" className="h-7 min-w-0 flex-1 rounded-md border border-input bg-card px-2 text-[10px] outline-none focus:border-ring" />
                  <Button type="button" size="sm" variant="outline" className="h-7 px-2 text-[10px]" onClick={saveProfile}>Speichern</Button>
                </div>
              </div>
              <div className={`app-shell app-accent-${branding.accent} app-background-${branding.background} overflow-hidden rounded-lg border border-border/70`}>
                <div className="app-header flex items-center gap-2 border-b px-2.5 py-2">
                  {branding.logo ? (
                    <img src={branding.logo} alt="Logo-Vorschau" className="app-preview-logo shrink-0 rounded bg-card object-contain" style={{ width: Math.max(20, branding.logoSize * 0.55), height: Math.max(20, branding.logoSize * 0.55) }} />
                  ) : (
                    <span className="app-logo-mark size-2.5 rounded-sm" />
                  )}
                  <div className="min-w-0">
                    <span className="module-eyebrow block">MCP · APP</span>
                    <span className="block truncate text-xs font-semibold">{previewTitle || record.title || "Feld-App"}</span>
                  </div>
                </div>
                <div className="app-preview-canvas grid grid-cols-[0.7fr_1.3fr] gap-1.5 p-2.5">
                  <div className="h-8 rounded border border-border bg-card shadow-sm" />
                  <div className="h-12 rounded border border-border bg-card shadow-sm" />
                </div>
              </div>
              <label className="block">
                <span className="module-eyebrow mb-1 block">Titel</span>
                <input
                  aria-label="Titel der App"
                  value={previewTitle}
                  placeholder={record.title ?? "Feld-App"}
                  onChange={(event) => setPreviewTitle(event.target.value)}
                  onBlur={(event) => saveBranding({ title: event.target.value.trim() })}
                  className="h-8 w-full rounded-md border border-input bg-card px-2.5 text-xs outline-none focus:border-ring"
                />
              </label>
              <div>
                <span className="module-eyebrow mb-1 block">Logo</span>
                <div className="flex items-center gap-2">
                  {branding.logo ? (
                    <img src={branding.logo} alt="App-Logo" className="size-9 rounded-md border border-border object-contain" />
                  ) : (
                    <div className="flex size-9 items-center justify-center rounded-md border border-dashed border-border bg-secondary">
                      <ImagePlus className="size-4 text-muted-foreground" />
                    </div>
                  )}
                  <input
                    ref={logoInput}
                    type="file"
                    accept="image/png,image/svg+xml,.png,.svg"
                    className="hidden"
                    onChange={(event) => void uploadLogo(event.target.files?.[0])}
                  />
                  <Button type="button" size="sm" variant="outline" className="h-8 text-xs" onClick={() => logoInput.current?.click()}>
                    {branding.logo ? "Ersetzen" : "Hochladen"}
                  </Button>
                  {branding.logo && (
                    <Button type="button" size="icon" variant="ghost" className="size-8" aria-label="Logo entfernen" onClick={() => saveBranding({ logo: "" })}>
                      <Trash2 className="size-3.5" />
                    </Button>
                  )}
                </div>
                {branding.logo && (
                  <label className="mt-2 grid grid-cols-[1fr_auto] items-center gap-2">
                    <span className="module-eyebrow">Logogröße</span>
                    <output className="font-mono text-[10px] text-muted-foreground">{branding.logoSize}px</output>
                    <input aria-label="Größe des Logos" type="range" min={24} max={72} step={4} value={branding.logoSize} onChange={(event) => saveBranding({ logoSize: Number(event.target.value) })} className="col-span-2 w-full accent-primary" />
                  </label>
                )}
              </div>
              <fieldset>
                <legend className="module-eyebrow mb-1.5">Akzentfarbe</legend>
                <div className="grid grid-cols-4 gap-1">
                  {APP_ACCENTS.map((accent) => (
                    <button
                      key={accent.id}
                      type="button"
                      aria-label={accent.label}
                      aria-pressed={branding.accent === accent.id}
                      title={accent.label}
                      onClick={() => saveBranding({ accent: accent.id })}
                      className={`flex h-8 items-center justify-center rounded-md border transition-colors ${branding.accent === accent.id ? "border-ring bg-accent" : "border-border/70 hover:bg-secondary"}`}
                    >
                      <span className={`size-3.5 rounded-full ${accent.swatch}`} />
                    </button>
                  ))}
                </div>
              </fieldset>
              <fieldset>
                <legend className="module-eyebrow mb-1.5">Hintergrund</legend>
                <div className="grid grid-cols-3 rounded-md border border-border/70 bg-secondary p-0.5">
                  {APP_BACKGROUNDS.map((background) => (
                    <button
                      key={background.id}
                      type="button"
                      aria-pressed={branding.background === background.id}
                      onClick={() => saveBranding({ background: background.id })}
                      className={`rounded px-2 py-1 text-[10px] font-medium transition-colors ${branding.background === background.id ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
                    >
                      {background.label}
                    </button>
                  ))}
                </div>
              </fieldset>
              <button
                type="button"
                onClick={() => { setPreviewTitle(""); saveBranding({ title: "", logo: "", logoSize: 40, accent: "forest", background: "stone" }); }}
                className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground"
              >
                <RotateCcw className="size-3" /> Standard wiederherstellen
              </button>
            </div>
            <div className="module-eyebrow px-1 pt-3 pb-1.5 text-muted-foreground">Module · Reihenfolge &amp; Darstellung</div>
            {layout.length === 0 && (
              <p className="px-1 py-2 text-[11px] text-muted-foreground">
                Noch keine Module auf diesem Feld.
              </p>
            )}
            <ul className="max-h-64 space-y-1 overflow-auto">
              {layout.map((entry, index) => {
                const member = members.find((m) => m.id === entry.id);
                if (!member) return null;
                return (
                  <li
                    key={entry.id}
                    className={`flex items-center gap-1 rounded-lg border border-border/60 px-1.5 py-1 ${entry.hidden ? "opacity-50" : ""}`}
                  >
                    <span className="min-w-0 flex-1 truncate text-[11px] font-medium">
                      {member.title ?? "Modul"}
                    </span>
                    <select
                      aria-label="Darstellung"
                      value={entry.view}
                      onChange={(e) =>
                        patchEntry(entry.id, { view: e.target.value === "compact" ? "compact" : "full" })
                      }
                      className="rounded-md border border-border/60 bg-card px-1 py-0.5 font-mono text-[10px] outline-none"
                    >
                      <option value="full">Breit</option>
                      <option value="compact">Kompakt</option>
                    </select>
                    <button
                      aria-label="Nach oben"
                      disabled={index === 0}
                      onClick={() => moveEntry(entry.id, -1)}
                      className="rounded p-0.5 text-muted-foreground hover:bg-accent disabled:opacity-30"
                    >
                      <ChevronUp className="size-3" />
                    </button>
                    <button
                      aria-label="Nach unten"
                      disabled={index === layout.length - 1}
                      onClick={() => moveEntry(entry.id, 1)}
                      className="rounded p-0.5 text-muted-foreground hover:bg-accent disabled:opacity-30"
                    >
                      <ChevronDown className="size-3" />
                    </button>
                    <button
                      aria-label={entry.hidden ? "Einblenden" : "Ausblenden"}
                      onClick={() => patchEntry(entry.id, { hidden: !entry.hidden })}
                      className="rounded p-0.5 text-muted-foreground hover:bg-accent"
                    >
                      {entry.hidden ? <EyeOff className="size-3" /> : <Eye className="size-3" />}
                    </button>
                  </li>
                );
              })}
            </ul>
            <p className="px-1 pt-1.5 text-[10px] leading-snug text-muted-foreground">
              Gilt für die App-Ansicht („Als App öffnen“) und Teams.
            </p>
          </div>
        )}
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
              <details open className="mt-1">
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
      <div className="flex items-center justify-between gap-2 border-b bg-secondary/20 px-3 py-1.5 text-[10px] text-muted-foreground">
        <span className="font-mono font-semibold">{rows.length} Zeilen · {columns.length} Felder</span>
        <div className="flex gap-2">
          <button className="nodrag font-semibold hover:text-foreground" onClick={() => openInspector(record.id, "data")}>Bearbeiten</button>
          {selected && <button className="nodrag font-semibold hover:text-foreground" onClick={() => openInspector(record.id, "refresh")}>Aktualisieren</button>}
        </div>
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
      <div className="module-heading flex items-center gap-2 border-b px-3 py-1.5">
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
            Als Faktor ablegen
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
      <SignalHandle type="target" position={Position.Left} />
      <SignalHandle type="target" position={Position.Top} />
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
      <SignalHandle type="source" position={Position.Right} />
      <SignalHandle type="source" position={Position.Bottom} />
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
  const stateRef = useRef({ text, editing });
  stateRef.current = { text, editing };
  useEffect(() => {
    if (selected) return;
    const { text: latest, editing: wasEditing } = stateRef.current;
    setEditing(false);
    // Beim Verlassen der Karte den zuletzt getippten Text sichern.
    if (wasEditing && latest !== (record.content ?? "")) {
      updateNode(record.id, { content: latest, title: latest.slice(0, 60) || "Text" });
    }
  }, [selected, record.id, record.content, updateNode]);

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

  const formatted = /(^|\n)\s*(#{1,3}\s|[-*+]\s|\d+[.)]\s|>)|\*\*|`/.test(text);

  return (
    <div className="relative flex h-full w-full items-center px-1">
      <NodeResizer
        minWidth={60}
        minHeight={28}
        isVisible={Boolean(selected)}
        color="var(--primary)"
        keepAspectRatio={false}
      />
      <SignalHandle type="target" position={Position.Left} />
      <SignalHandle type="source" position={Position.Right} />
      {selected && !editing ? <TextToolbar record={record} /> : null}
      {selected ? (
        <div className="absolute -top-7 right-0 z-10 flex items-center gap-0.5 rounded-full border border-border/70 bg-card p-0.5 shadow-sm">
          <button
            type="button"
            aria-pressed={editing}
            className={`nodrag rounded-full px-2 py-0.5 text-[10px] ${
              editing ? "bg-secondary text-foreground" : "text-muted-foreground"
            }`}
            onClick={() => setEditing(true)}
          >
            Markdown
          </button>
          <button
            type="button"
            aria-pressed={!editing}
            className={`nodrag rounded-full px-2 py-0.5 text-[10px] ${
              editing ? "text-muted-foreground" : "bg-secondary text-foreground"
            }`}
            onClick={() => save()}
          >
            Ansicht
          </button>
        </div>
      ) : null}
      {editing ? (
        <div className="flex h-full w-full flex-col gap-1">
          <textarea
            ref={areaRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                setText(record.content ?? "");
                setEditing(false);
              }
            }}
            placeholder="Text – Überschriften mit #, Listen mit - oder 1."
            rows={1}
            style={boxStyle}
            className={`nodrag nowheel min-h-[40%] flex-1 w-full resize-none rounded-md px-1 outline-none ring-1 ring-ring/40 placeholder:text-muted-foreground/60 ${size.className}`}
          />
          <div className="nowheel nodrag flex-1 overflow-auto rounded-md border border-dashed border-border/70 px-1">
            <div className="sticky top-0 bg-card/80 text-[9px] uppercase tracking-wide text-muted-foreground">
              Vorschau
            </div>
            <div style={boxStyle} className={`${size.className} ${formatted ? "" : "whitespace-pre-wrap"}`}>
              {text ? formatted ? <Markdown source={text} /> : text : (
                <span className="text-muted-foreground/60">Noch kein Text</span>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div
          onDoubleClick={() => setEditing(true)}
          style={boxStyle}
          className={`nowheel h-full w-full cursor-text overflow-auto rounded-md px-1 ${
            formatted ? "" : "whitespace-pre-wrap "
          }${size.className}${selected ? " ring-1 ring-ring/40" : ""}`}
        >
          {text ? (
            formatted ? (
              <Markdown source={text} />
            ) : (
              text
            )
          ) : (
            <span className="text-muted-foreground/60">Beschriftung</span>
          )}
        </div>
      )}
    </div>
  );
});

/** Connection with an editable value label ("25 %", "2500") at its midpoint. */
export function LabeledEdge(props: EdgeProps) {
  const { updateEdge, deleteEdge, calcForEdge } = useBoard();
  const [path, labelX, labelY] = getSmoothStepPath({
    sourceX: props.sourceX,
    sourceY: props.sourceY,
    sourcePosition: props.sourcePosition,
    targetX: props.targetX,
    targetY: props.targetY,
    targetPosition: props.targetPosition,
    borderRadius: 4,
  });
  const label = typeof props.label === "string" ? props.label : "";
  const labelsVisible = useEdgeLabelsVisible();
  const { setEdges } = useReactFlow();
  // live value travelling along this connection (source value after the label)
  const flow = useStore(
    (store) => {
      const records: Record<string, NodeRecord> = {};
      for (const [id, item] of store.nodeLookup) {
        const record = (item.data as Data | undefined)?.record;
        if (record) records[id] = record;
      }
      const source = records[props.source];
      const raw = source ? valueOfNode(source, records, store.edges) : null;
      const result = edgeValue(label, raw);
      if (result == null) return { text: "", bad: raw != null, raw };
      return { text: formatValue(result, readFormat(source?.metadata)), bad: false, raw };
    },
    (a, b) => a.text === b.text && a.bad === b.bad && a.raw === b.raw,
  );
  const problem = flow.bad ? edgeProblem(label, flow.raw) : null;
  const stroke = props.selected
    ? "var(--ring)"
    : flow.bad
      ? "#de5a3a"
      : "var(--edge)";

  return (
    <>
      <BaseEdge
        id={`${props.id}-casing`}
        path={path}
        interactionWidth={0}
        style={{ stroke: "var(--card)", strokeWidth: props.selected ? 7 : 5.5 }}
      />
      <BaseEdge
        id={props.id}
        path={path}
        interactionWidth={24}
        {...(props.markerEnd ? { markerEnd: props.markerEnd } : {})}
        style={{
          stroke,
          strokeWidth: props.selected ? 3 : 2.25,
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
          {props.selected && labelsVisible ? (
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
              <UiTooltip>
                <TooltipTrigger asChild>
                  <button
                    aria-label="Verbindung löschen"
                    className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-destructive"
                    onClick={() => deleteEdge(props.id)}
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </TooltipTrigger>
                <UiTooltipContent>Verbindung löschen</UiTooltipContent>
              </UiTooltip>
              <UiTooltip>
                <TooltipTrigger asChild>
                  <button
                    aria-label="Beschriftung schließen"
                    className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                    onClick={() =>
                      setEdges((list) =>
                        list.map((item) =>
                          item.id === props.id ? { ...item, selected: false } : item,
                        ),
                      )
                    }
                  >
                    <X className="size-3.5" />
                  </button>
                </TooltipTrigger>
                <UiTooltipContent>Schließen</UiTooltipContent>
              </UiTooltip>
            </div>
          ) : problem ? (
            <div className="edge-problem w-[236px] rounded-lg border border-[#de5a3a]/60 bg-card p-2 text-left shadow-[var(--shadow-float)]">
              <div className="flex items-start gap-1.5">
                <AlertTriangle className="mt-[1px] size-3.5 shrink-0 text-[#de5a3a]" />
                <div className="min-w-0">
                  <p className="text-[11px] font-semibold leading-tight text-[#de5a3a]">
                    {problem.title}
                  </p>
                  <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
                    {problem.cause}
                  </p>
                  <p className="mt-1 text-[11px] leading-snug text-foreground">
                    <span className="font-medium">So lösen: </span>
                    {problem.fix}
                  </p>
                  <button
                    className="mt-1.5 rounded-md border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                    onClick={() =>
                      setEdges((list) =>
                        list.map((item) =>
                          item.id === props.id ? { ...item, selected: true } : item,
                        ),
                      )
                    }
                  >
                    Rechnung bearbeiten
                  </button>
                </div>
              </div>
            </div>
          ) : labelsVisible && (label || flow.text) ? (
            <span
              title="Aktueller Wert auf dieser Verbindung"
              className="flex items-center gap-1 rounded-full border border-border bg-card px-2 py-0.5 font-mono text-[11px] leading-tight text-foreground shadow-[var(--shadow-card)]"
            >
              {label ? <span className="font-medium">{label}</span> : null}
              {flow.text ? (
                <>
                  {label ? <span className="text-muted-foreground">=</span> : null}
                  <span className="font-semibold">{flow.text}</span>
                </>
              ) : null}
            </span>
          ) : props.selected ? (
            <button
              aria-label="Verbindung löschen"
              title="Verbindung löschen (oder Entf/Delete drücken)"
              className="rounded-full border border-border/70 bg-card p-1 text-muted-foreground shadow-[var(--shadow-card)] transition-colors hover:text-destructive"
              onClick={() => deleteEdge(props.id)}
            >
              <Trash2 className="size-3" />
            </button>
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
      className={`module-card flex h-full w-full flex-col overflow-hidden border bg-card ${
        selected ? "border-ring/60 shadow-[var(--shadow-float)]" : "border-border/70"
      }`}
      data-selected={Boolean(selected)}
    >
      <NodeResizer isVisible={Boolean(selected)} minWidth={260} minHeight={180} />
      <SignalHandle type="target" position={Position.Left} />
      <SignalHandle type="source" position={Position.Right} />
      <div className="module-heading flex items-center gap-2 border-b px-3 py-2">
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
  const flowNodes = useStore((state) => state.nodes);
  const linkedType = linked
    ? ((flowNodes.find((n) => n.id === linked.sourceId)?.data as { record?: NodeRecord } | undefined)
        ?.record?.type ?? null)
    : null;
  const threshold = (key: string, fallback: number | null) => {
    const parsed = Number(meta[key]);
    return Number.isFinite(parsed) ? parsed : fallback;
  };
  // inspection sources flag red as soon as one immediate measure exists
  const warnAbove = threshold("warnAbove", linkedType === "inspect" ? 1 : null);
  const dangerAbove = threshold("dangerAbove", linkedType === "inspect" ? 1 : null);
  const valueColor = (shown: number | null): string | undefined => {
    if (shown == null) return undefined;
    if (dangerAbove != null && shown >= dangerAbove) return "var(--destructive)";
    if (warnAbove != null && shown >= warnAbove) return "var(--brand-orange)";
    if (dangerAbove != null || warnAbove != null) return "var(--support)";
    return undefined;
  };
  function patch(next: Record<string, unknown>) {
    updateNode(record.id, { metadata: { ...(record.metadata ?? {}), ...next } });
  }
  return (
    <div
      className={`module-card flex h-full w-full flex-col overflow-hidden border bg-card ${
        selected ? "border-ring/60 shadow-[var(--shadow-float)]" : "border-border/70"
      }`}
      data-selected={Boolean(selected)}
    >
      <NodeResizer isVisible={Boolean(selected)} minWidth={180} minHeight={130} />
      <SignalHandle type="target" position={Position.Left} />
      <SignalHandle type="target" position={Position.Top} />
      <SignalHandle type="source" position={Position.Right} />
      <SignalHandle type="source" position={Position.Bottom} />
      <input
        key={record.id + (record.title ?? "")}
        defaultValue={record.title ?? "Kennzahl"}
        className="module-heading nodrag border-b bg-transparent px-3 py-2 text-sm font-medium outline-none"
        onBlur={(e) => updateNode(record.id, { title: e.target.value.trim() || "Kennzahl" })}
      />
      <div className="flex flex-1 flex-col justify-center px-3 py-2">
        <div className="flex items-baseline gap-1">
          {(() => {
            const shown = linked ? linked.value : Number.isFinite(value) ? value : null;
            const text = formatValue(shown ?? null, fmt);
            const size = text.length > 12 ? "text-lg" : text.length > 8 ? "text-2xl" : "text-3xl";
            const color = valueColor(shown);
            return linked ? (
              <span
                className={`min-w-0 flex-1 truncate font-display font-semibold tracking-tight ${size}`}
                style={color ? { color } : undefined}
              >
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
        {warnAbove != null || dangerAbove != null ? (
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 border-t pt-1.5 font-mono text-[9px] text-muted-foreground">
            <span className="flex items-center gap-1">
              <span className="size-2 rounded-full" style={{ background: "var(--support)" }} />
              unter {formatValue(warnAbove ?? dangerAbove ?? 0, fmt)}
            </span>
            {warnAbove != null ? (
              <span className="flex items-center gap-1">
                <span className="size-2 rounded-full" style={{ background: "var(--brand-orange)" }} />
                ab {formatValue(warnAbove, fmt)}
              </span>
            ) : null}
            {dangerAbove != null ? (
              <span className="flex items-center gap-1">
                <span className="size-2 rounded-full" style={{ background: "var(--destructive)" }} />
                ab {formatValue(dangerAbove, fmt)}
              </span>
            ) : null}
          </div>
        ) : null}
        {selected ? <FormatRow meta={meta} onPatch={patch} /> : null}
        {selected ? (
          <div className="nodrag mt-2 flex items-center gap-2 border-t pt-2 text-[10px] text-muted-foreground">
            <span className="shrink-0">Farbe:</span>
            <label className="flex items-center gap-1">
              ab
              <input
                key={record.id + "warn" + String(meta["warnAbove"] ?? "")}
                defaultValue={meta["warnAbove"] != null ? String(meta["warnAbove"]) : ""}
                inputMode="decimal"
                placeholder="–"
                aria-label="Gelb ab"
                className="w-10 rounded border border-border/60 bg-background px-1 py-0.5 text-foreground outline-none"
                onBlur={(e) => {
                  const text = e.target.value.trim().replace(",", ".");
                  patch({ warnAbove: text === "" ? null : Number(text) });
                }}
              />
              <span style={{ color: "var(--brand-orange)" }}>gelb</span>
            </label>
            <label className="flex items-center gap-1">
              ab
              <input
                key={record.id + "danger" + String(meta["dangerAbove"] ?? "")}
                defaultValue={meta["dangerAbove"] != null ? String(meta["dangerAbove"]) : ""}
                inputMode="decimal"
                placeholder="–"
                aria-label="Rot ab"
                className="w-10 rounded border border-border/60 bg-background px-1 py-0.5 text-foreground outline-none"
                onBlur={(e) => {
                  const text = e.target.value.trim().replace(",", ".");
                  patch({ dangerAbove: text === "" ? null : Number(text) });
                }}
              />
              <span className="text-destructive">rot</span>
            </label>
          </div>
        ) : null}
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
      className={`module-card flex h-full w-full flex-col overflow-hidden border bg-card ${
        selected ? "border-ring/60 shadow-[var(--shadow-float)]" : "border-border/70"
      }`}
      data-selected={Boolean(selected)}
    >
      <NodeResizer isVisible={Boolean(selected)} minWidth={220} minHeight={200} />
      <SignalHandle type="target" position={Position.Left} />
      <SignalHandle type="target" position={Position.Top} />
      <SignalHandle type="source" position={Position.Right} />
      <SignalHandle type="source" position={Position.Bottom} />

      <input
        key={record.id + (record.title ?? "")}
        defaultValue={record.title ?? "Tacho"}
        className="module-heading nodrag border-b bg-transparent px-3 py-2 text-sm font-medium outline-none"
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
      className={`module-card flex h-full w-full flex-col overflow-hidden border bg-card ${
        selected ? "border-ring/60 shadow-[var(--shadow-float)]" : "border-border/70"
      }`}
      data-selected={Boolean(selected)}
    >
      <NodeResizer isVisible={Boolean(selected)} minWidth={280} minHeight={180} />
      <SignalHandle type="target" position={Position.Left} />
      <SignalHandle type="source" position={Position.Right} />
      <input
        key={record.id + (record.title ?? "")}
        defaultValue={record.title ?? "Rechenblatt"}
        className="module-heading nodrag border-b bg-transparent px-3 py-2 text-sm font-medium outline-none"
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
      className={`module-card flex h-full w-full flex-col overflow-hidden border bg-card ${
        selected ? "border-ring/60 shadow-[var(--shadow-float)]" : "border-border/70"
      }`}
      data-selected={Boolean(selected)}
      style={{ borderTop: `3px solid ${NODE_ACCENT["api"] ?? "var(--primary)"}` }}
    >
      <NodeResizer isVisible={Boolean(selected)} minWidth={280} minHeight={200} />
      <SignalHandle type="target" position={Position.Left} />
      <SignalHandle type="source" position={Position.Right} />
      <div className="module-heading flex items-center gap-1.5 border-b px-3 py-2">
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

      <div className="module-heading flex items-center gap-2 border-b px-3 py-1.5">
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
  const confidenceOf = (answer: (typeof answers)[number] | undefined) => {
    const value = Number(answer?.confidence);
    return Number.isFinite(value) ? value : null;
  };
  const answered = answers.filter((answer) => answerLabel(answer) !== "–");
  const ratedAnswers = answers.filter((answer) => confidenceOf(answer) !== null);
  const confidence = ratedAnswers.length
    ? Math.round(ratedAnswers.reduce((sum, answer) => sum + (confidenceOf(answer) ?? 0), 0) / ratedAnswers.length * 100)
    : null;
  const reviewCount = questions.filter((question) => {
    const answer = answers.find((item) => item.id === question.id);
    const limit = typeof question.minConfidence === "number" ? question.minConfidence : threshold;
    const answerConfidence = confidenceOf(answer);
    return answerConfidence === null || answerConfidence * 100 < limit;
  }).length;

  function writeQuestions(next: DecisionQuestion[]) {
    updateNode(record.id, { metadata: { ...(record.metadata ?? {}), questions: next } });
  }

  return (
    <div
      className={`module-card flex h-full w-full flex-col overflow-hidden border bg-card ${
        selected ? "border-ring/60 shadow-[var(--shadow-float)]" : "border-border/70"
      }`}
      data-selected={Boolean(selected)}
      style={{ borderTop: `3px solid ${NODE_ACCENT["decision"] ?? "var(--primary)"}` }}
    >
      <NodeResizer isVisible={Boolean(selected)} minWidth={300} minHeight={220} />
      <SignalHandle type="target" position={Position.Left} />
      <SignalHandle type="source" position={Position.Right} />
      <div className="module-heading flex items-center gap-1.5 border-b px-3 py-2">
        <Scale className="size-3.5 shrink-0 text-muted-foreground" />
        <input
          key={record.id + (record.title ?? "")}
          defaultValue={record.title ?? "Entscheidung"}
          className="nodrag min-w-0 flex-1 bg-transparent text-sm font-medium outline-none"
          onBlur={(e) => updateNode(record.id, { title: e.target.value.trim() || "Entscheidung" })}
        />
        <span className="rounded-full border bg-card px-2 py-0.5 font-mono text-[10px] text-muted-foreground">
          {inputs.length} Quellen
        </span>
      </div>

      <div className={`border-b px-3 py-3 ${reviewCount ? "bg-destructive/10" : "bg-support/10"}`}>
        <div className="flex items-start justify-between gap-2">
          <div>
            <span className="text-[9px] font-bold uppercase text-muted-foreground">Aktuelle Lage</span>
            <p className="font-display text-xl font-bold leading-tight">
              {answered.length === 0 ? "Noch nicht bewertet" : reviewCount ? `${reviewCount} Prüfungen offen` : "Entscheidung belastbar"}
            </p>
          </div>
          <span className="rounded-full border bg-card px-2 py-1 font-mono text-[10px] font-semibold">
            {confidence === null ? "–" : `${confidence} % sicher`}
          </span>
        </div>
      </div>

      <div className="nowheel flex-1 overflow-auto px-3 py-2">
        {questions.map((question, index) => {
          const answer = answers.find((item) => item.id === question.id);
          const own = typeof question.minConfidence === "number" ? question.minConfidence : null;
          const limit = own ?? threshold;
          const low = typeof answer?.confidence === "number" && answer.confidence * 100 < limit;
          return (
            <details key={question.id} open className="group border-b border-border/60 py-1.5 last:border-0">
              <summary className="nodrag flex cursor-pointer list-none items-center gap-2 py-1">
                <span className={`flex size-7 shrink-0 items-center justify-center rounded-md ${low ? "bg-destructive/10 text-destructive" : answer ? "bg-support/10 text-support" : "bg-secondary text-muted-foreground"}`}>
                  {low ? <AlertTriangle className="size-3.5" /> : <span className="font-mono text-[10px]">{index + 1}</span>}
                </span>
                <span className="min-w-0 flex-1 truncate text-xs font-semibold">{question.instructions || `Frage ${index + 1}`}</span>
                <span className={`shrink-0 text-[10px] font-semibold ${low ? "text-destructive" : "text-muted-foreground"}`}>
                  {answer ? answerLabel(answer) : "Offen"}
                </span>
                <ChevronRight className="size-3 shrink-0 text-muted-foreground transition-transform group-open:rotate-90" />
              </summary>
              <div className="mt-1 rounded-md bg-secondary/30 p-2">
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
            </details>
          );
        })}
      </div>
      <details open className="group border-t bg-secondary/20 px-3 py-1.5">
        <summary className="nodrag flex cursor-pointer list-none items-center justify-between text-[10px] font-semibold uppercase text-muted-foreground">
          Konfiguration <ChevronRight className="size-3 transition-transform group-open:rotate-90" />
        </summary>
        <div className="space-y-2 py-2">
          <textarea
            key={record.id + "policy"}
            defaultValue={typeof meta["policy"] === "string" ? (meta["policy"] as string) : ""}
            placeholder="Gemeinsame Regel"
            aria-label="Regel für alle Fragen"
            className="nodrag min-h-12 w-full resize-none rounded-md border bg-background px-2 py-1 text-xs outline-none"
            onBlur={(e) => updateNode(record.id, { metadata: { ...(record.metadata ?? {}), policy: e.target.value } })}
          />
          <label className="flex items-center justify-between gap-2 text-[10px] text-muted-foreground">
            Mindest-Sicherheit
            <span><input type="number" min={0} max={100} step={5} key={record.id + "minconf"} defaultValue={threshold} aria-label="Mindest-Sicherheit in Prozent" className="nodrag w-14 rounded-md border bg-background px-1 py-0.5 text-right" onBlur={(e) => { const value = Number(e.target.value); updateNode(record.id, { metadata: { ...(record.metadata ?? {}), minConfidence: Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : 80 } }); }} /> %</span>
          </label>
          <button className="nodrag flex items-center gap-1 text-[10px] font-semibold text-muted-foreground hover:text-foreground" onClick={() => writeQuestions([...questions, { id: `f${Date.now().toString(36)}`, type: "noul", instructions: "", options: [] }])}>
            <Plus className="size-3" /> Frage hinzufügen
          </button>
        </div>
      </details>
      <div className="border-t p-2.5">
        <Button className="nodrag w-full font-semibold" disabled={running || questions.length === 0} onClick={() => runDecide(record.id)}>
          <Sparkles className={`mr-1.5 size-3.5 ${running ? "animate-pulse" : ""}`} />
          {running ? "Prüft …" : "Entscheidung aktualisieren"}
        </Button>
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

  const invert = meta["invert"] === true;
  const tone =
    yes === null
      ? { bg: "var(--muted)", fg: "var(--muted-foreground)", text: "Noch keine Entscheidung" }
      : unsure
        ? { bg: "var(--warn, #ea580c)", fg: "#ffffff", text: "KEINE EMPFEHLUNG" }
        : yes !== invert
          ? { bg: "var(--ok, #16a34a)", fg: "#ffffff", text: yes ? yesLabel : noLabel }
          : { bg: "var(--danger, #dc2626)", fg: "#ffffff", text: yes ? yesLabel : noLabel };

  return (
    <div
      className={`module-card flex h-full w-full flex-col overflow-hidden border bg-card ${
        selected ? "border-ring/60 shadow-[var(--shadow-float)]" : "border-border/70"
      }`}
      data-selected={Boolean(selected)}
    >
      <NodeResizer isVisible={Boolean(selected)} minWidth={180} minHeight={140} />
      <SignalHandle type="target" position={Position.Left} />
      <SignalHandle type="target" position={Position.Top} />
      <input
        key={record.id + (record.title ?? "")}
        defaultValue={record.title ?? "Signal"}
        className="module-heading nodrag border-b bg-transparent px-3 py-2 text-sm font-medium outline-none"
        onBlur={(e) => updateNode(record.id, { title: e.target.value.trim() || "Signal" })}
      />
      <div
        className="flex flex-1 flex-col items-center justify-center gap-1 px-3 py-3 text-center"
        style={{ background: tone.bg, color: tone.fg }}
      >
        <span className="text-[9px] font-bold uppercase opacity-80">Aktueller Status</span>
        <span className="font-display text-4xl font-semibold leading-none tracking-tight">
          {confidence === null ? "–" : `${Math.round(confidence)} %`}
        </span>
        <span className="font-display text-base font-semibold tracking-tight">{tone.text}</span>
        {confidence !== null && (
          <span className="text-[10px] opacity-90">Schwelle {Math.round(threshold)} %{unsure ? " nicht erreicht" : " erreicht"}</span>
        )}
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
          <label className="mt-1 flex cursor-pointer items-center gap-1.5 text-[10px] text-muted-foreground">
            <input
              type="checkbox"
              className="nodrag"
              checked={invert}
              onChange={(e) =>
                updateNode(record.id, {
                  metadata: { ...(record.metadata ?? {}), invert: e.target.checked },
                })
              }
            />
            Maßnahme: grün bei „Nein" (nichts zu tun)
          </label>
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
          ? "Kein Entscheidungs-Modul in diesem Scope"
          : "Noch kein Ergebnis – im Entscheidungs-Modul erst auf „Entscheiden“ klicken",
      );
      return;
    }
    patch({ marks: [...config.marks, ...added].slice(-60) });
    toast.success(`${added.length} Entscheidungen festgehalten`);
  }

  return (
    <div
      className={`module-card flex h-full w-full flex-col overflow-hidden border bg-card ${
        selected ? "border-ring/60 shadow-[var(--shadow-float)]" : "border-border/70"
      }`}
      data-selected={Boolean(selected)}
    >
      <NodeResizer isVisible={Boolean(selected)} minWidth={320} minHeight={280} />
      <SignalHandle type="target" position={Position.Left} />
      <SignalHandle type="target" position={Position.Top} />
      <SignalHandle type="source" position={Position.Right} />
      <SignalHandle type="source" position={Position.Bottom} />
      <div className="module-heading flex items-center gap-2 border-b px-3 py-2">
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
  const focus = useMapFocus();


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
      let answer: { status: number; body: string } | null = null;
      // Open-Meteo begrenzt Anfragen zeitweise (429) – bis zu dreimal mit Pause wiederholen.
      for (let attempt = 0; attempt < 3; attempt++) {
        answer = await runApiModule({
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
        if (answer.status !== 429) break;
        if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 3000 + attempt * 4000));
      }
      if (!answer || answer.status === 429) {
        throw new Error("Wetterdienst gerade überlastet – bitte in einer Minute erneut versuchen");
      }
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
      className={`module-card flex h-full w-full flex-col overflow-hidden border bg-card ${
        selected ? "border-ring/60 shadow-[var(--shadow-float)]" : "border-border/70"
      }`}
      data-selected={Boolean(selected)}
    >
      <NodeResizer isVisible={Boolean(selected)} minWidth={320} minHeight={280} />
      <SignalHandle type="target" position={Position.Left} />
      <SignalHandle type="target" position={Position.Top} />
      <SignalHandle type="source" position={Position.Right} />
      <SignalHandle type="source" position={Position.Bottom} />

      <div className="module-heading flex items-center gap-2 border-b px-3 py-1.5">
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

      <div className="flex items-center justify-between gap-3 border-b bg-secondary/25 px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className={`flex size-7 shrink-0 items-center justify-center rounded-md ${risky ? "bg-destructive/10 text-destructive" : "bg-support/10 text-support"}`}>
            <CloudSun className="size-4" />
          </span>
          <div className="min-w-0">
            <p className="text-xs font-bold">{risky ? `${risky} Wetterwarnungen` : `${points.length} Anlagen stabil`}</p>
            <p className="truncate text-[9px] text-muted-foreground">{config.lastAt ? `Stand ${new Date(config.lastAt).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })}` : "Wetter noch nicht abgerufen"}</p>
          </div>
        </div>
        <span className="shrink-0 font-mono text-xs font-semibold">{points.length} Objekte</span>
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
              highlightIds={focus.ids}

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

      {focus.ids.length > 0 && (
        <div className="flex items-center justify-between gap-2 border-t bg-accent/60 px-3 py-1 text-[10px]">
          <span className="min-w-0 truncate">
            Hervorgehoben: {focus.label} ({focus.ids.length})
          </span>
          <button
            type="button"
            className="nodrag shrink-0 rounded-full px-2 py-0.5 hover:bg-background"
            onClick={() => clearMapFocus()}
          >
            zurücksetzen
          </button>
        </div>
      )}

      {picked && (
        <div className="border-t px-3 py-1.5 text-[11px]">
          {(() => {
            const point = points.find((item) => item.id === picked);
            if (!point) return null;
            const w = config.weather[point.id];
            return (
              <div className="flex items-start gap-2">
                {point.photo ? (
                  <img
                    src={point.photo}
                    alt={point.label}
                    className="size-14 shrink-0 rounded-md border border-border/60 object-cover"
                  />
                ) : null}
                <div className="min-w-0">
                  <p>
                    <strong>{point.label}</strong>
                    {point.klass ? ` · ${point.klass}` : ""} ·{" "}
                    {w ? `Regen ${w.rain ?? "?"} mm/h, Wind ${w.wind ?? "?"} km/h` : "kein Wetter"}
                  </p>
                  {point.note ? (
                    <p className="mt-0.5 text-muted-foreground">{point.note}</p>
                  ) : null}
                </div>
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
});

/** Risk assessment after ISO 55001 / ISO 31000 with a 5x5 matrix. */
export const RiskNode = memo(function RiskNode({ id, data, selected }: NodeProps) {
  const record = (data as unknown as Data).record;
  const { updateNode } = useBoard();
  const edges = useEdges();
  const flowNodes = useStore((state) => state.nodes);
  const config = readIsoRisk(record);
  const [openField, setOpenField] = useState<string | null>(null);
  const [explainField, setExplainField] = useState<string | null>(null);

  const { mapRecords, tables, decisions } = useMemo(() => {
    const byId = Object.fromEntries(
      flowNodes.map((n) => [n.id, (n.data as { record: NodeRecord }).record]),
    ) as Record<string, NodeRecord>;
    const linked = edges
      .filter((edge) => edge.target === id || edge.source === id)
      .map((edge) => byId[edge.target === id ? edge.source : edge.target])
      .filter((item): item is NodeRecord => Boolean(item));
    const maps = linked.filter((item) => item.type === "map");
    return {
      mapRecords: maps.length ? maps : Object.values(byId).filter((item) => item?.type === "map"),
      tables: Object.values(byId).filter(
        (item) => item?.type === "table" || item?.type === "list",
      ),
      decisions: edges
        .filter((edge) => edge.source === id)
        .map((edge) => byId[edge.target])
        .filter((item): item is NodeRecord => item?.type === "decision"),
    };
  }, [edges, flowNodes, id]);

  /** All geocoded points plus their weather, gathered from connected maps. */
  const { points, weather } = useMemo(() => {
    const all: GeoPoint[] = [];
    const seen: Record<string, WeatherValue> = {};
    for (const mapRecord of mapRecords) {
      const mapConfig = readMapConfig(mapRecord);
      const sources = edges
        .filter((edge) => edge.target === mapRecord.id || edge.source === mapRecord.id)
        .map((edge) => {
          const otherId = edge.target === mapRecord.id ? edge.source : edge.target;
          return flowNodes.find((n) => n.id === otherId)?.data as
            | { record: NodeRecord }
            | undefined;
        })
        .map((item) => item?.record)
        .filter((item): item is NodeRecord => Boolean(item));
      all.push(...pointsFromSources(sources, mapConfig));
      Object.assign(seen, mapConfig.weather);
    }
    return { points: all, weather: seen };
  }, [mapRecords, edges, flowNodes]);

  const liveWeather = useMemo(
    () => weatherChance(points, weather, config),
    [points, weather, config],
  );
  const liveAge = useMemo(() => ageChance(tables), [tables]);

  /** Worst measured weather value across all objects, shown as the evidence cell. */
  const peaks = useMemo(() => {
    let wind: number | null = null;
    let rain: number | null = null;
    for (const point of points) {
      const value = weather[point.id];
      if (!value) continue;
      if (value.wind != null) wind = Math.max(wind ?? 0, value.wind);
      if (value.rain != null) rain = Math.max(rain ?? 0, value.rain);
    }
    return { wind, rain };
  }, [points, weather]);

  /** Factor cards connected to this matrix, with the labels of the path to it. */
  const evidencePaths = useMemo(() => {
    const byId = Object.fromEntries(
      flowNodes.map((node) => [node.id, (node.data as { record: NodeRecord }).record]),
    ) as Record<string, NodeRecord>;
    const visited = new Set<string>([id]);
    const pending: Array<{ nodeId: string; labels: string[] }> = [{ nodeId: id, labels: [] }];
    const found: Array<{ record: NodeRecord; labels: string[] }> = [];
    while (pending.length) {
      const step = pending.shift();
      if (!step) continue;
      for (const edge of edges) {
        if (edge.target !== step.nodeId || visited.has(edge.source)) continue;
        visited.add(edge.source);
        const source = byId[edge.source];
        if (!source) continue;
        const label = typeof edge.label === "string" ? edge.label.trim() : "";
        const labels = label ? [label, ...step.labels] : step.labels;
        if (source.type === "note") found.push({ record: source, labels });
        if (source.type === "note" || source.type === "frame")
          pending.push({ nodeId: source.id, labels });
      }
    }
    return found;
  }, [edges, flowNodes, id]);

  const evidence = useMemo(() => evidencePaths.map((item) => item.record), [evidencePaths]);

  /** Weighted score of every connected factor card, scaled by the edge labels. */
  const factors = useMemo(() => {
    const map: Record<
      string,
      { label: string; score: number; level: number; count: number; raw: number; transform: string }
    > = {};
    for (const { record: note, labels } of evidencePaths) {
      const factor = readFactor(note);
      if (!factor.params.length) continue;
      let value: number | null = factor.score;
      for (const label of labels) value = edgeValue(label, value);
      const scaled = value == null ? factor.score : Math.min(10, Math.max(0, Math.round(value * 10) / 10));
      map[note.id] = {
        label: note.title ?? "Faktor",
        score: scaled,
        level: levelOf(scaled),
        count: factor.params.length,
        raw: factor.score,
        transform: labels.join(" · "),
      };
    }
    return map;
  }, [evidencePaths]);

  /** Themes: background fields with a weight, scored by the factor cards on them. */
  const themes = useMemo<ThemeScore[]>(() => {
    const records = flowNodes.map((node) => (node.data as { record: NodeRecord }).record);
    const zoneRecords = records.filter((item) => item.type === "zone" && readThemeWeight(item) > 0);
    return zoneRecords.map((zone) => {
      const members = records.filter(
        (item) => item.type === "note" && (readAssignment(item)?.zoneId ?? null) === zone.id,
      );
      const scores = members.map((item) => readFactor(item)).filter((item) => item.params.length);
      const score = scores.length
        ? Math.round((scores.reduce((sum, item) => sum + item.score, 0) / scores.length) * 10) / 10
        : 0;
      return {
        id: zone.id,
        title: zone.title ?? "Feld",
        weight: readThemeWeight(zone),
        score,
        factors: scores.length,
      };
    });
  }, [flowNodes]);
  const overallIndex = useMemo(() => themeIndex(themes), [themes]);

  /** Fields with automatic likelihood replaced by live evidence. */
  const fields = useMemo(
    () =>
      config.fields.map((field) => {
        if (field.auto === "weather" && liveWeather != null) {
          return { ...field, chance: liveWeather };
        }
        if (field.auto === "age" && liveAge) return { ...field, chance: liveAge.level };
        if (field.auto === "factor") {
          const factor = factors[field.factorId ?? ""];
          if (factor) return { ...field, chance: factor.level };
        }
        return field;
      }),
    [config.fields, liveWeather, liveAge, factors],
  );

  const result = useMemo(() => evaluate(fields), [fields]);
  const summary = useMemo(() => {
    const assessment = isoText(result);
    const parts = [assessment];
    if (themes.length) {
      const themeText = themes
        .map(
          (theme) =>
            `- ${theme.title}: Themengewicht ${theme.weight} %, Faktorwert ${theme.score.toFixed(1)} / 10 aus ${theme.factors} Karten`,
        )
        .join("\n");
      parts.push(`Gesamtgewichtung der Themen (Index ${overallIndex} / 100):\n${themeText}`);
    }
    if (evidence.length) {
      const evidenceText = evidence
        .map((item) => {
          const factor = readFactor(item);
          const weights = factor.params.length ? `\n${factorText(item.title ?? "Faktor", factor)}` : "";
          return `### ${noteRole(item).eyebrow}: ${item.title ?? "Eintrag"}\n${item.content ?? ""}${weights}`;
        })
        .join("\n\n");
      parts.push(`Fachliche Nachweiskette (${evidence.length} Einträge):\n${evidenceText}`);
    }
    return parts.join("\n\n");
  }, [evidence, result, themes, overallIndex]);

  useEffect(() => {
    if (summary && summary !== record.content) updateNode(record.id, { content: summary });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [summary]);

  function patch(next: Record<string, unknown>) {
    updateNode(record.id, { metadata: { ...(record.metadata ?? {}), ...next } });
  }

  function setFields(next: RiskField[]) {
    patch({ fields: next });
  }

  function updateField(fieldId: string, change: Partial<RiskField>) {
    setFields(
      config.fields.map((field) => (field.id === fieldId ? { ...field, ...change } : field)),
    );
  }

  /** Write one cell and keep the old value in the change log. */
  function commit(
    fieldId: string,
    key: RiskChange["key"],
    value: string | number | undefined,
    extra?: Partial<RiskField>,
  ) {
    const current = config.fields.find((field) => field.id === fieldId);
    if (!current) return;
    const from = current[key];
    if ((from ?? "") === (value ?? "")) return;
    const entry: RiskChange = {
      id: `${Date.now()}-${key}-${fieldId}`,
      at: Date.now(),
      fieldId,
      code: current.code,
      label: current.name,
      key,
      from,
      to: value,
    };
    patch({
      fields: config.fields.map((field) =>
        field.id === fieldId ? { ...field, ...extra, [key]: value } : field,
      ),
      history: [entry, ...config.history].slice(0, 40),
    });
  }

  /** Drop own measurement and threshold of one row in a single step. */
  function resetOverrides(fieldId: string) {
    const current = config.fields.find((field) => field.id === fieldId);
    if (!current) return;
    const entries: RiskChange[] = (["measureText", "limitText"] as const)
      .filter((key) => current[key])
      .map((key) => ({
        id: `${Date.now()}-${key}-${fieldId}`,
        at: Date.now(),
        fieldId,
        code: current.code,
        label: current.name,
        key,
        from: current[key],
        to: "",
      }));
    patch({
      fields: config.fields.map((field) =>
        field.id === fieldId ? { ...field, measureText: "", limitText: "" } : field,
      ),
      history: [...entries, ...config.history].slice(0, 40),
    });
  }

  /** Take back the latest edit and restore the previous cell value. */
  function undoLast() {
    const [last, ...rest] = config.history;
    if (!last) return;
    patch({
      fields: config.fields.map((field) =>
        field.id === last.fieldId ? { ...field, [last.key]: last.from } : field,
      ),
      history: rest,
    });
  }

  function changeText(value: string | number | undefined): string {
    if (value === undefined || value === "") return "leer";
    if (value === "none") return "eigener Wert";
    if (value === "weather") return "Wetter der Karte";
    if (value === "age") return "Alter der Anlagen";
    return String(value);
  }

  function addField() {
    const next = config.fields.length + 1;
    setFields([
      ...config.fields,
      {
        id: `r${Date.now()}`,
        code: `R${next}`,
        name: "Neues Risiko",
        note: "",
        chance: 3,
        impact: 3,
        auto: "none",
      },
    ]);
  }

  /** Show which objects on the map belong to a risk field. */
  function focusOnMap(field: (typeof result.fields)[number]) {
    if (field.auto === "weather") {
      const ids = points
        .filter((point) => {
          const value = weather[point.id];
          if (!value) return false;
          return (value.rain ?? 0) >= config.rainWarn || (value.wind ?? 0) >= config.windWarn;
        })
        .map((point) => point.id);
      setMapFocus(ids.length ? ids : points.map((point) => point.id), field.name);
      return;
    }
    setMapFocus(
      points.map((point) => point.id),
      field.name,
    );
  }

  const focus = useMapFocus();

  return (
    <div
      className={`module-card flex h-full w-full flex-col overflow-hidden border bg-card ${
        selected ? "border-ring/60 shadow-[var(--shadow-float)]" : "border-border/70"
      }`}
      data-selected={Boolean(selected)}
    >
      <NodeResizer isVisible={Boolean(selected)} minWidth={360} minHeight={320} />
      <SignalHandle type="target" position={Position.Left} />
      <SignalHandle type="target" position={Position.Top} />
      <SignalHandle type="source" position={Position.Right} />
      <SignalHandle type="source" position={Position.Bottom} />

      <div className="module-heading flex items-center gap-2 border-b px-3 py-1.5">
        <input
          key={record.id + (record.title ?? "")}
          defaultValue={record.title ?? "Risikomatrix"}
          className="nodrag min-w-0 flex-1 bg-transparent text-sm font-medium outline-none"
          onBlur={(e) => updateNode(record.id, { title: e.target.value.trim() || "Risikomatrix" })}
        />
        <span
          className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium text-slate-900"
          style={{ background: result.portfolio.color }}
        >
          Klasse {result.portfolio.key}
        </span>
      </div>

      <div className="border-b px-3 py-3" style={{ background: `color-mix(in oklab, ${result.portfolio.color} 20%, var(--card))` }}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <span className="text-[9px] font-bold uppercase text-muted-foreground">Aktuelle Risikostufe</span>
            <p className="truncate font-display text-2xl font-bold leading-none">{result.portfolio.label}</p>
            <p className="mt-1 truncate text-[10px] text-muted-foreground">Höchstes Risiko: {result.fields.find((field) => field.score === result.highest)?.name ?? "–"}</p>
          </div>
          <div className="shrink-0 text-right">
            <span className="font-mono text-xl font-bold">{result.index}</span>
            <p className="text-[9px] uppercase text-muted-foreground">Index / 100</p>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between border-b bg-secondary/20 px-3 py-1.5 text-[10px] text-muted-foreground">
        <span className="font-semibold">Nachweiskette</span>
        <span className="font-mono">{evidence.length} fachliche Einträge verbunden</span>
      </div>

      <div className="nowheel flex-1 overflow-auto p-2">
        <section>
          <div className="module-eyebrow mb-1">Tabelle</div>
          <div className="overflow-hidden rounded-md border border-border/70">
            <table className="w-full table-fixed border-collapse text-[10px]">
              <thead>
                <tr className="bg-secondary/40 text-muted-foreground">
                  <th className="w-7 px-1 py-1 text-left font-mono font-normal">R</th>
                  <th className="px-1 py-1 text-left font-medium">Risiko</th>
                  <th className="w-28 px-1 py-1 text-left font-medium">Messwert</th>
                  <th className="w-20 px-1 py-1 text-left font-medium">Grenzwert</th>
                  <th className="w-6 px-1 py-1 text-right font-medium">E</th>
                  <th className="w-6 px-1 py-1 text-right font-medium">A</th>
                  <th className="w-8 px-1 py-1 text-right font-medium">S</th>
                  <th className="w-5 px-1 py-1 text-center font-medium">K</th>
                </tr>
              </thead>
              <tbody>
                {result.fields.map((field) => {
                  const measure = measureOf(field, {
                    config,
                    weatherLevel: liveWeather,
                    peakWind: peaks.wind,
                    peakRain: peaks.rain,
                    ageYears: liveAge?.years ?? null,
                    ageLevel: liveAge?.level ?? null,
                    factors,
                  });
                  const open = openField === field.id;
                  const showExplain = explainField === field.id;
                  const explain = explainScore(field, measure);
                  /* every cell that feeds the score of the active row */
                  const dep = open
                    ? "bg-[color-mix(in_oklab,var(--ring)_16%,transparent)] outline outline-1 outline-[var(--ring)]"
                    : "";
                  return (
                    <Fragment key={field.id}>
                      <tr
                        className={`nodrag cursor-pointer border-t border-border/60 align-middle hover:bg-secondary/30 ${
                          open ? "bg-secondary/30" : ""
                        }`}
                        onClick={() => {
                          focusOnMap(field);
                          setOpenField(open ? null : field.id);
                        }}
                        title="Zeile öffnen, abhängige Werte hervorheben und Objekte auf der Karte zeigen"
                      >
                        <td className="px-1 py-1 font-mono text-muted-foreground">{field.code}</td>
                        <td className="truncate px-1 py-1 font-medium" title={field.name}>
                          {field.name}
                        </td>
                        <td
                          className={`px-1 py-1 ${dep}`}
                          onClick={(event) => event.stopPropagation()}
                        >
                          <input
                            key={`m-${field.id}-${field.measureText ?? ""}`}
                            defaultValue={field.measureText ?? measure.text ?? ""}
                            placeholder="–"
                            aria-label={`Messwert ${field.code}`}
                            className={`nodrag h-5 w-full rounded border border-transparent bg-transparent px-0.5 font-mono tabular-nums outline-none hover:border-border focus:border-ring ${
                              measure.breach ? "text-destructive" : "text-foreground"
                            }`}
                            onBlur={(e) => commit(field.id, "measureText", e.target.value.trim())}
                          />
                        </td>
                        <td
                          className={`px-1 py-1 ${dep}`}
                          onClick={(event) => event.stopPropagation()}
                        >
                          <input
                            key={`l-${field.id}-${field.limitText ?? ""}`}
                            defaultValue={field.limitText ?? measure.limit ?? ""}
                            placeholder="–"
                            aria-label={`Grenzwert ${field.code}`}
                            className="nodrag h-5 w-full rounded border border-transparent bg-transparent px-0.5 font-mono tabular-nums text-muted-foreground outline-none hover:border-border focus:border-ring"
                            onBlur={(e) => commit(field.id, "limitText", e.target.value.trim())}
                          />
                        </td>
                        <td className={`px-1 py-1 ${dep}`} onClick={(e) => e.stopPropagation()}>
                          <select
                            value={field.chance}
                            aria-label={`Eintritt ${field.code}`}
                            className="nodrag h-5 w-full rounded border border-transparent bg-transparent text-right font-mono tabular-nums outline-none hover:border-border focus:border-ring"
                            onChange={(e) =>
                              commit(field.id, "chance", Number(e.target.value), { auto: "none" })
                            }
                          >
                            {[1, 2, 3, 4, 5].map((value) => (
                              <option key={value} value={value}>
                                {value}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className={`px-1 py-1 ${dep}`} onClick={(e) => e.stopPropagation()}>
                          <select
                            value={field.impact}
                            aria-label={`Auswirkung ${field.code}`}
                            className="nodrag h-5 w-full rounded border border-transparent bg-transparent text-right font-mono tabular-nums outline-none hover:border-border focus:border-ring"
                            onChange={(e) => commit(field.id, "impact", Number(e.target.value))}
                          >
                            {[1, 2, 3, 4, 5].map((value) => (
                              <option key={value} value={value}>
                                {value}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className={`px-1 py-1 text-right ${dep}`}>
                          <button
                            type="button"
                            title="Formel und Eingabewerte zeigen"
                            className="nodrag rounded px-1 font-mono font-semibold tabular-nums text-slate-900"
                            style={{ background: field.klass.color }}
                            onClick={(event) => {
                              event.stopPropagation();
                              setExplainField(showExplain ? null : field.id);
                            }}
                          >
                            {field.score}
                          </button>
                        </td>
                        <td className="px-1 py-1 text-center font-semibold">{field.klass.key}</td>
                      </tr>
                      {showExplain && (
                        <tr className="border-t border-border/60 bg-primary/5">
                          <td colSpan={8} className="px-1.5 py-1.5">
                            <div className="space-y-1 text-[10px]">
                              <p className="module-eyebrow text-muted-foreground">So entsteht der Wert</p>
                              <p className="font-mono text-[10px] font-semibold">{explain.formula}</p>
                              <ul className="space-y-0.5">
                                {explain.inputs.map((input) => (
                                  <li key={input.label} className="flex items-start gap-1">
                                    <span className="w-20 shrink-0 text-muted-foreground">
                                      {input.label}
                                    </span>
                                    <span className="min-w-0 flex-1">
                                      <span className="font-mono">{input.value}</span>
                                      <span className="text-muted-foreground"> · {input.hint}</span>
                                    </span>
                                  </li>
                                ))}
                              </ul>
                              <p>{explain.reason}</p>
                              <p className="text-muted-foreground">Empfehlung: {explain.next}</p>
                            </div>
                          </td>
                        </tr>
                      )}
                      {open && (
                        <tr className="border-t border-border/60 bg-secondary/10">
                          <td colSpan={8} className="px-1.5 py-1.5">
                            <div className="space-y-1 text-[10px]">
                              <p className="font-mono text-[9px] text-muted-foreground">
                                {measure.rule} · Quelle: {measure.source}
                              </p>
                              <input
                                defaultValue={field.name}
                                aria-label="Name des Risikos"
                                className="nodrag h-6 w-full rounded-md border border-border/70 bg-background px-1 text-[10px] outline-none"
                                onBlur={(e) => commit(field.id, "name", e.target.value.trim())}
                              />
                              <input
                                defaultValue={field.note}
                                aria-label="Hinweis / Nachweis"
                                placeholder="Nachweis, z. B. Störungsstatistik, DWD-Projektion"
                                className="nodrag h-6 w-full rounded-md border border-border/70 bg-background px-1 text-[10px] outline-none"
                                onBlur={(e) => commit(field.id, "note", e.target.value)}
                              />
                              <label className="flex items-center gap-1">
                                <span className="w-24 shrink-0">Eintritt (E)</span>
                                <input
                                  type="range"
                                  min={1}
                                  max={5}
                                  step={1}
                                  value={field.chance}
                                  aria-label="Eintrittswahrscheinlichkeit"
                                  className="nodrag min-w-0 flex-1"
                                  onChange={(e) =>
                                    commit(field.id, "chance", Number(e.target.value), {
                                      auto: "none",
                                    })
                                  }
                                />
                                <span className="w-4 text-right font-mono">{field.chance}</span>
                              </label>
                              <label className="flex items-center gap-1">
                                <span className="w-24 shrink-0">Auswirkung (A)</span>
                                <input
                                  type="range"
                                  min={1}
                                  max={5}
                                  step={1}
                                  value={field.impact}
                                  aria-label="Auswirkung"
                                  className="nodrag min-w-0 flex-1"
                                  onChange={(e) =>
                                    commit(field.id, "impact", Number(e.target.value))
                                  }
                                />
                                <span className="w-4 text-right font-mono">{field.impact}</span>
                              </label>
                              <label className="flex items-center gap-1">
                                <span className="w-24 shrink-0">Eintritt kommt aus</span>
                                <select
                                  value={field.auto}
                                  aria-label="Quelle der Eintrittswahrscheinlichkeit"
                                  className="nodrag h-6 min-w-0 flex-1 rounded-md border border-border/70 bg-background px-1 text-[10px] outline-none"
                                  onChange={(e) =>
                                     commit(
                                      field.id,
                                      "auto",
                                      e.target.value as RiskField["auto"],
                                    )
                                  }
                                >
                                  <option value="none">eigener Wert</option>
                                  <option value="weather">Wetter auf der Karte</option>
                                  <option value="age">Alter der Anlagen</option>
                                  <option value="factor">gewichtete Faktorkarte</option>
                                </select>
                              </label>
                              {field.auto === "factor" && (
                                <label className="flex items-center gap-1">
                                  <span className="w-24 shrink-0">Faktorkarte</span>
                                  <select
                                    value={field.factorId ?? ""}
                                    aria-label="Verbundene Faktorkarte"
                                    className="nodrag h-6 min-w-0 flex-1 rounded-md border border-border/70 bg-background px-1 text-[10px] outline-none"
                                    onChange={(e) => commit(field.id, "factorId", e.target.value)}
                                  >
                                    <option value="">Faktor wählen …</option>
                                    {Object.entries(factors).map(([factorId, factor]) => (
                                      <option key={factorId} value={factorId}>
                                        {factor.label} · {factor.score.toFixed(1)}/10
                                      </option>
                                    ))}
                                  </select>
                                </label>
                              )}
                              <div className="flex items-center justify-between pt-0.5">
                                <span className="text-muted-foreground">{field.klass.action}</span>
                                <span className="flex items-center gap-1">
                                  {(field.measureText || field.limitText) && (
                                    <button
                                      type="button"
                                      className="nodrag rounded-full px-2 py-0.5 text-muted-foreground hover:bg-accent"
                                      onClick={() => resetOverrides(field.id)}
                                    >
                                      eigene Werte zurücksetzen
                                    </button>
                                  )}
                                  <button
                                    type="button"
                                    className="nodrag rounded-full px-2 py-0.5 text-destructive hover:bg-accent"
                                    onClick={() =>
                                      setFields(config.fields.filter((item) => item.id !== field.id))
                                    }
                                  >
                                    entfernen
                                  </button>
                                </span>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
                {/* aggregation row, like the sum line of a spreadsheet */}
                <tr className="border-t-2 border-border bg-secondary/40 font-medium">
                  <td className="px-1 py-1" />
                  <td className="px-1 py-1">Portfolio ({result.fields.length} Risiken)</td>
                  <td className="px-1 py-1 font-mono text-muted-foreground" colSpan={2}>
                    Index {result.index} / 100
                  </td>
                  <td className="px-1 py-1 text-right font-mono text-muted-foreground" colSpan={2}>
                    max
                  </td>
                  <td className="px-1 py-1 text-right">
                    <span
                      className="rounded px-1 font-mono font-semibold tabular-nums text-slate-900"
                      style={{ background: result.portfolio.color }}
                    >
                      {result.highest}
                    </span>
                  </td>
                  <td className="px-1 py-1 text-center font-semibold">{result.portfolio.key}</td>
                </tr>
              </tbody>
            </table>
            <button
              type="button"
              className="nodrag w-full border-t border-border/60 py-1 text-[10px] text-muted-foreground hover:bg-accent"
              onClick={addField}
            >
              + Zeile hinzufügen
            </button>
          </div>
        </section>

        <section className="mt-3">
          <div className="module-eyebrow mb-1">Matrix</div>
          <div className="flex gap-1">
            <span className="w-4 shrink-0 rotate-180 self-center text-center text-[9px] text-muted-foreground [writing-mode:vertical-rl]">
              Eintrittswahrscheinlichkeit
            </span>
            <div className="min-w-0 flex-1">
              {[5, 4, 3, 2, 1].map((chance) => (
                <div key={chance} className="mb-0.5 flex items-stretch gap-0.5">
                  <span className="flex w-16 shrink-0 items-center justify-end pr-1 text-right text-[8px] leading-tight text-muted-foreground">
                    {chance} {LIKELIHOOD_LABEL[chance]}
                  </span>
                  <div className="grid min-w-0 flex-1 grid-cols-5 gap-0.5">
                    {[1, 2, 3, 4, 5].map((impact) => {
                      const score = chance * impact;
                      const here = result.fields.filter(
                        (field) => field.chance === chance && field.impact === impact,
                      );
                      return (
                        <div
                          key={`${chance}-${impact}`}
                          className="flex min-h-9 flex-col items-center justify-center rounded-sm px-0.5 py-1 text-slate-900"
                          style={{ background: scoreColor(score) }}
                          title={here.map((field) => field.name).join(", ")}
                        >
                          <span className="font-mono text-[9px] opacity-70">{score}</span>
                          {here.map((field) => (
                            <span key={field.id} className="text-[9px] font-semibold leading-tight">
                              {field.code}
                            </span>
                          ))}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
              <div className="flex gap-0.5 pl-16">
                {[1, 2, 3, 4, 5].map((impact) => (
                  <span
                    key={impact}
                    className="flex-1 text-center text-[8px] leading-tight text-muted-foreground"
                  >
                    {impact} {IMPACT_LABEL[impact]}
                  </span>
                ))}
              </div>
              <p className="pl-16 pt-0.5 text-center text-[9px] text-muted-foreground">Auswirkung</p>
            </div>
          </div>
        </section>

        <section className="mt-3">
          <div className="module-eyebrow mb-1">Einordnung</div>
          <div className="space-y-1.5 text-[10px] text-muted-foreground">
            <div className="flex flex-wrap gap-x-2 gap-y-1">
              {RISK_CLASSES.map((item) => (
                <span key={item.key} className="flex items-center gap-1">
                  <span className="size-2 rounded-sm" style={{ background: item.color }} />
                  {item.label} · {item.range}
                </span>
              ))}
            </div>
            <p>{result.portfolio.action}</p>
            {themes.length > 0 && (
              <div className="rounded-md border border-border/70 p-1.5">
                <div className="module-eyebrow mb-1">
                  Gesamtgewichtung der Themen · Index {overallIndex} / 100
                </div>
                <ul className="space-y-0.5">
                  {themes.map((theme) => (
                    <li key={theme.id} className="flex items-center gap-2">
                      <span className="w-9 shrink-0 text-right font-mono tabular-nums">
                        {theme.weight}%
                      </span>
                      <span className="min-w-0 flex-1 truncate text-foreground">{theme.title}</span>
                      <span className="shrink-0 font-mono tabular-nums">
                        {theme.score.toFixed(1)}/10
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <p>
              {focus.label
                ? `Karte: ${focus.label} (${focus.ids.length} Objekte)`
                : "Zeile auswählen, um Objekte auf der Karte zu markieren."}
            </p>
            <p>
              {decisions.length
                ? `Weitergabe an ${decisions.map((item) => item.title ?? "Entscheidung").join(", ")}`
                : "Noch keine Entscheidung verbunden"}
            </p>
            {selected && (
              <div className="grid grid-cols-2 gap-1 border-t pt-2">
                {(
                  [
                    ["rainWarn", "Regen Warnung mm/h"],
                    ["rainDanger", "Regen Gefahr mm/h"],
                    ["windWarn", "Wind Warnung km/h"],
                    ["windDanger", "Wind Gefahr km/h"],
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
        </section>

        <section className="mt-3">
          <div className="module-eyebrow mb-1">Verlauf</div>
          <div className="space-y-1.5 text-[10px]">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">
                {config.history.length
                  ? `${config.history.length} Änderungen aufgezeichnet`
                  : "Noch keine Änderungen"}
              </span>
              <button
                type="button"
                disabled={!config.history.length}
                className="nodrag rounded-full border border-border/70 px-2 py-0.5 hover:bg-accent disabled:opacity-40"
                onClick={undoLast}
              >
                Letzte Änderung rückgängig
              </button>
            </div>
            <ul className="space-y-1">
              {config.history.map((entry) => (
                <li
                  key={entry.id}
                  className="rounded-md border border-border/60 px-1.5 py-1"
                >
                  <div className="flex items-center justify-between gap-1">
                    <span className="truncate font-medium">
                      <span className="font-mono text-muted-foreground">{entry.code}</span>{" "}
                      {entry.label} · {CHANGE_LABEL[entry.key]}
                    </span>
                    <span className="shrink-0 font-mono text-[9px] text-muted-foreground">
                      {new Date(entry.at).toLocaleTimeString("de-DE", {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                  </div>
                  <p className="font-mono text-[9px] text-muted-foreground">
                    vorher {changeText(entry.from)} → jetzt {changeText(entry.to)}
                  </p>
                </li>
              ))}
            </ul>
          </div>
        </section>
      </div>
    </div>
  );
});


/** Inspection photos of substations: assessment, priority, cost and action plan. */
export const InspectNode = memo(function InspectNode({ data, selected }: NodeProps) {
  const record = (data as unknown as Data).record;
  const { updateNode } = useBoard();
  const config = readInspection(record);
  const [busy, setBusy] = useState(0);
  const [report, setReport] = useState("");
  const fileRef = useRef<HTMLInputElement | null>(null);

  const findings = useMemo(
    () => [...config.findings].sort((a, b) => a.priority - b.priority),
    [config.findings],
  );
  const summary = useMemo(() => inspectionText(findings), [findings]);

  // keep the chat / decision context in sync with the action plan
  const lastSummary = useRef<string | null>(null);
  useEffect(() => {
    if (summary === lastSummary.current) return;
    lastSummary.current = summary;
    if (summary !== record.content) updateNode(record.id, { content: summary });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [summary]);

  function save(next: Finding[]) {
    updateNode(record.id, {
      metadata: { ...(record.metadata ?? {}), findings: next, rates: config.rates },
    });
  }

  async function handleFiles(files: FileList | File[]) {
    const list = Array.from(files).filter((file) => file.type.startsWith("image/"));
    if (!list.length) return;
    setBusy(list.length);
    const added: Finding[] = [];
    for (const file of list) {
      try {
        const [image, thumb, gps] = await Promise.all([
          downscale(file, 1024, 0.75),
          downscale(file, 180, 0.6),
          exifLocation(file),
        ]);
        const result = await analyzeInspection({
          data: {
            image,
            label: labelFromFile(file.name),
            report,
            rates: Object.entries(config.rates)
              .map(([key, value]) => `${key}: ${value} EUR`)
              .join(", "),
          },
        });
        const priority = Math.min(10, Math.max(1, Math.round(result.priority)));
        const previous = config.findings.find(
          (item) => item.label.toLowerCase() === result.label.trim().toLowerCase(),
        );
        added.push({
          id: `f-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          label: result.label.trim() || labelFromFile(file.name),
          lat: gps?.lat ?? null,
          lon: gps?.lon ?? null,
          category: result.category.trim() || "Sonstiges",
          finding: result.finding,
          priority,
          action: result.action,
          cost: result.cost > 0 ? Math.round(result.cost) : rateFor(result.category, config.rates),
          confidence: Math.min(100, Math.max(0, Math.round(result.confidence))),
          reason: result.reason,
          thumb,
          createdAt: new Date().toISOString(),
          prevPriority: previous ? previous.priority : null,
          status: "offen",
          owner: previous?.owner ?? "",
          due: previous?.due ?? "",
          source: gps ? "exif" : "unbekannt",
        });
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Foto konnte nicht bewertet werden");
      } finally {
        setBusy((count) => Math.max(0, count - 1));
      }
    }
    if (added.length) {
      save([...config.findings, ...added]);
      const blind = added.filter((item) => item.lat == null).length;
      toast.success(
        blind
          ? `${added.length} Foto(s) bewertet – ${blind} ohne Ortung, Koordinaten bitte eintragen`
          : `${added.length} Foto(s) bewertet und auf der Karte verortet`,
      );
    }
  }

  function patchFinding(id: string, next: Partial<Finding>) {
    save(config.findings.map((item) => (item.id === id ? { ...item, ...next } : item)));
  }

  const total = totalCost(findings);
  const urgent = findings.filter((item) => item.priority <= 3 && item.status !== "erledigt");
  const overdue = findings.filter(isOverdue).length;
  const located = findings.filter((item) => item.lat != null && item.lon != null).length;

  return (
    <div
      className={`module-card flex h-full w-full flex-col overflow-hidden border bg-card ${
        selected ? "border-ring/60 shadow-[var(--shadow-float)]" : "border-border/70"
      }`}
      data-selected={Boolean(selected)}
    >
      <NodeResizer isVisible={Boolean(selected)} minWidth={360} minHeight={320} />
      <SignalHandle type="target" position={Position.Left} />
      <SignalHandle type="target" position={Position.Top} />
      <SignalHandle type="source" position={Position.Right} />
      <SignalHandle type="source" position={Position.Bottom} />

      <div className="module-heading flex items-center gap-2 border-b px-3 py-1.5">
        <input
          key={record.id + (record.title ?? "")}
          defaultValue={record.title ?? "Inspektion"}
          className="nodrag min-w-0 flex-1 bg-transparent text-sm font-medium outline-none"
          onBlur={(e) => updateNode(record.id, { title: e.target.value.trim() || "Inspektion" })}
        />
        <Button
          size="sm"
          variant="secondary"
          className="nodrag h-7 rounded-full px-2 text-[11px]"
          disabled={busy > 0}
          onClick={() => fileRef.current?.click()}
        >
          <Camera className={`size-3 ${busy ? "animate-pulse" : ""}`} />
          {busy ? `${busy} in Prüfung …` : "Fotos hinzufügen"}
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files) void handleFiles(e.target.files);
            e.target.value = "";
          }}
        />
      </div>

      <div className="grid grid-cols-3 gap-2 border-b bg-secondary/25 px-3 py-2">
        <div>
          <p className="module-eyebrow">Sofort offen</p>
          <p className="kpi-value" style={{ color: urgent.length ? "#dc2626" : undefined }}>
            {urgent.length}
          </p>
          <div className="kpi-bar" style={{ background: urgent.length ? "#dc2626" : "#16a34a" }} />
          <p className="font-mono text-[9px] text-muted-foreground">
            {overdue ? `${overdue} überfällig` : "kein Termin überschritten"}
          </p>
        </div>
        <div>
          <p className="module-eyebrow">Befunde</p>
          <p className="kpi-value">{findings.length}</p>
          <p className="font-mono text-[9px] text-muted-foreground">{located} verortet</p>
        </div>
        <div>
          <p className="module-eyebrow">Kosten</p>
          <p className="kpi-value">{euro(total)}</p>
          <p className="font-mono text-[9px] text-muted-foreground">geschätzt</p>
        </div>
      </div>

      <div
        className="nodrag flex-1 space-y-3 overflow-visible px-3 py-2"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          if (e.dataTransfer.files.length) void handleFiles(e.dataTransfer.files);
        }}
      >
        {findings.length - located > 0 && (
          <p className="rounded-md border border-dashed px-2 py-1 text-[10px]" style={{ borderColor: "#dc2626", color: "#dc2626" }}>
            {findings.length - located} Befund(e) ohne vollständige Koordinaten – sie erscheinen
            nicht auf der Karte. Breite und Länge unten am Eintrag eintragen.
          </p>
        )}

        <div>
          <p className="module-eyebrow mb-1">Prüfbericht zum Foto (optional)</p>
          <Textarea
            value={report}
            onChange={(e) => setReport(e.target.value)}
            placeholder="Stations-Kennung, Datum, Beobachtung des Prüfers …"
            className="nodrag min-h-[52px] text-[11px]"
          />
        </div>

        {!findings.length && (
          <p className="rounded-md border border-dashed border-border/70 px-3 py-4 text-center text-[11px] text-muted-foreground">
            Fotos hierher ziehen oder oben auswählen. Standortangaben im Foto werden automatisch
            gelesen und auf der verbundenen Karte angezeigt.
          </p>
        )}

        {CLUSTERS.map((cluster) => {
          const rows = findings.filter(
            (item) => item.priority >= cluster.from && item.priority <= cluster.to,
          );
          if (!rows.length) return null;
          const sum = totalCost(rows);
          return (
            <section key={cluster.id}>
              <div className="mb-1 flex items-center justify-between">
                <span className="module-eyebrow" style={{ color: cluster.color }}>
                  {cluster.label} · Prio {cluster.from}–{cluster.to}
                </span>
                <span className="font-mono text-[10px] text-muted-foreground">
                  {rows.length} · {euro(sum)}
                </span>
              </div>
              <ul className="space-y-1.5">
                {rows.map((finding) => {
                  const shift =
                    finding.prevPriority != null ? finding.prevPriority - finding.priority : 0;
                  return (
                    <li
                      key={finding.id}
                      className="rounded-md border border-border/60 p-1.5"
                      onClick={(e) => {
                        if ((e.target as HTMLElement).closest("input,button,textarea")) return;
                        if (finding.lat != null && finding.lon != null) {
                          setMapFocus([finding.id], finding.label);
                        }
                      }}
                    >
                      <div className="flex items-start gap-2">
                        {finding.thumb ? (
                          <img
                            src={finding.thumb}
                            alt={finding.label}
                            className="size-12 shrink-0 rounded object-cover"
                          />
                        ) : null}
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-2">
                            <span className="truncate text-[11px] font-semibold">
                              {finding.label}
                            </span>
                            <span
                              className="shrink-0 rounded-full px-1.5 py-0.5 font-mono text-[9px] font-bold text-white"
                              style={{ background: priorityColor(finding.priority) }}
                            >
                              PRIO {finding.priority}
                            </span>
                          </div>
                          <p className="text-[10px] text-muted-foreground">
                            {finding.category} · {finding.finding}
                          </p>
                          <p className="text-[10px]">{finding.action}</p>
                          <div className="mt-1 flex flex-wrap items-center gap-2 font-mono text-[9px] text-muted-foreground">
                            <span>{euro(finding.cost)}</span>
                            <span>Sicherheit {finding.confidence} %</span>
                            <span>
                              {finding.lat != null
                                ? `${finding.lat.toFixed(4)}, ${finding.lon?.toFixed(4)}`
                                : "ohne Ortung"}
                            </span>
                            {shift !== 0 && (
                              <span style={{ color: shift > 0 ? "#dc2626" : "#16a34a" }}>
                                {shift > 0 ? "▲" : "▼"} vorher Prio {finding.prevPriority}
                              </span>
                            )}
                          </div>
                          <div
                            className="mt-1 flex flex-wrap items-center gap-1"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <select
                              value={finding.status}
                              aria-label="Status"
                              className="nodrag rounded-full border px-1.5 py-0.5 font-mono text-[9px] font-bold text-white outline-none"
                              style={{
                                background: STATUS_COLOR[finding.status],
                                borderColor: STATUS_COLOR[finding.status],
                              }}
                              onChange={(e) =>
                                patchFinding(finding.id, {
                                  status: e.target.value as Finding["status"],
                                })
                              }
                            >
                              {STATUS_VALUES.map((value) => (
                                <option key={value} value={value} className="text-foreground">
                                  {value}
                                </option>
                              ))}
                            </select>
                            <input
                              key={finding.id + "owner" + finding.owner}
                              defaultValue={finding.owner}
                              placeholder="verantwortlich"
                              aria-label="Verantwortliche Person"
                              className="nodrag w-24 rounded border border-border/70 px-1 py-0.5 text-[9px]"
                              onBlur={(e) => patchFinding(finding.id, { owner: e.target.value.trim() })}
                            />
                            <input
                              key={finding.id + "due" + finding.due}
                              type="date"
                              defaultValue={finding.due}
                              aria-label="Fällig am"
                              className="nodrag rounded border px-1 py-0.5 font-mono text-[9px]"
                              style={
                                isOverdue(finding)
                                  ? { borderColor: "#dc2626", color: "#dc2626" }
                                  : { borderColor: "var(--border)" }
                              }
                              onBlur={(e) => patchFinding(finding.id, { due: e.target.value })}
                            />
                            {isOverdue(finding) && (
                              <span className="font-mono text-[9px]" style={{ color: "#dc2626" }}>
                                überfällig
                              </span>
                            )}
                          </div>
                          {(finding.lat == null || finding.lon == null) && (
                            <div
                              className="mt-1 flex items-center gap-1"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <input
                                placeholder="Breite"
                                defaultValue={finding.lat ?? ""}
                                className="nodrag w-20 rounded border border-border/70 px-1 py-0.5 font-mono text-[9px]"
                                onBlur={(e) => {
                                  const lat = Number(e.target.value.replace(",", "."));
                                  if (Number.isFinite(lat) && lat !== 0) {
                                    patchFinding(finding.id, { lat, source: "manuell" });
                                  }
                                }}
                              />
                              <input
                                placeholder="Länge"
                                defaultValue={finding.lon ?? ""}
                                className="nodrag w-20 rounded border border-border/70 px-1 py-0.5 font-mono text-[9px]"
                                onBlur={(e) => {
                                  const lon = Number(e.target.value.replace(",", "."));
                                  if (Number.isFinite(lon) && lon !== 0) {
                                    patchFinding(finding.id, { lon, source: "manuell" });
                                  }
                                }}
                              />
                            </div>
                          )}
                        </div>
                        <button
                          type="button"
                          className="nodrag shrink-0 text-muted-foreground hover:text-destructive"
                          onClick={(e) => {
                            e.stopPropagation();
                            save(config.findings.filter((item) => item.id !== finding.id));
                          }}
                        >
                          <Trash2 className="size-3" />
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
});

/** Ruft ein Werkzeug eines externen MCP-Servers auf und hält dessen Antwort. */
export const McpNode = memo(function McpNode({ data, selected }: NodeProps) {
  const record = (data as unknown as Data).record;
  const { updateNode, runMcp } = useBoard();
  const config = readMcp(record);
  const meta = (record.metadata ?? {}) as Record<string, unknown>;
  const running = meta["mcpRunning"] === true;
  const value = mcpValue(record);
  const [connectOpen, setConnectOpen] = useState(false);
  const [section, setSection] = useState<"input" | "context" | "output" | "result" | "history">(
    "input",
  );
  const history = readMcpHistory(record);
  const servers = useQuery({
    queryKey: ["mcp-servers"],
    queryFn: () => listMcpServers(),
    staleTime: 60_000,
  });
  const server = servers.data?.find((item) => item.id === config.serverId);
  const tools = server?.tools ?? [];
  const tool = tools.find((item) => item.name === config.tool);
  const fields = useMemo(() => schemaFields(tool?.inputSchema), [tool?.inputSchema]);
  const missing = missingRequired(fields, config.inputs);
  const paths = useMemo(() => suggestPaths(record.content), [record.content]);
  const linked = useConnectedRecords(record.id);
  const linkable = linked.filter((item) => item.id !== record.id);
  const notes = contextCards(linked);

  function patch(next: Record<string, unknown>) {
    updateNode(record.id, { metadata: { ...(record.metadata ?? {}), ...next } });
  }

  /** Speichert einen Formularwert und hält das JSON für den Aufruf aktuell. */
  function setInput(name: string, raw: string) {
    const inputs = { ...config.inputs, [name]: raw };
    patch({ mcpInputs: inputs, mcpArgs: JSON.stringify(argsFromInputs(fields, inputs)) });
  }

  function setBinding(name: string, nodeId: string) {
    const bindings = { ...config.bindings };
    if (nodeId) bindings[name] = nodeId;
    else delete bindings[name];
    patch({ mcpBindings: bindings });
  }

  /** Legt fest, welcher Teil einer verbundenen Textkarte als Kontext dient. */
  function setContext(nodeId: string, choice: string) {
    const next = { ...config.context };
    if (choice) next[nodeId] = choice;
    else delete next[nodeId];
    patch({ mcpContext: next });
  }




  return (
    <div
      className={`module-card flex h-full w-full flex-col overflow-hidden border bg-card ${
        selected ? "border-ring/60 shadow-[var(--shadow-float)]" : "border-border/70"
      }`}
      data-selected={Boolean(selected)}
      style={{ borderTop: `3px solid ${NODE_ACCENT["mcp"] ?? "var(--primary)"}` }}
    >
      <NodeResizer isVisible={Boolean(selected)} minWidth={300} minHeight={240} />
      <SignalHandle type="target" position={Position.Left} />
      <SignalHandle type="source" position={Position.Right} />

      <div className="module-heading flex items-center gap-1.5 border-b px-3 py-2">
        <Plug className="size-3.5 shrink-0 text-muted-foreground" />
        <input
          key={record.id + (record.title ?? "")}
          defaultValue={record.title ?? "MCP-Werkzeug"}
          className="nodrag min-w-0 flex-1 bg-transparent text-sm font-medium outline-none"
          onBlur={(e) => updateNode(record.id, { title: e.target.value.trim() || "MCP-Werkzeug" })}
        />
      </div>

      <div className="grid gap-1.5 border-b px-3 py-2">
        <Select
          value={config.serverId}
          onValueChange={(next) => {
            if (next === "__new__") {
              setConnectOpen(true);
              return;
            }
            const chosen = servers.data?.find((item) => item.id === next);
            patch({
              mcpServerId: next,
              mcpServerName: chosen?.name ?? "",
              mcpTool: "",
              lastError: null,
            });
          }}
        >
          <SelectTrigger className="nodrag h-8 text-xs" aria-label="MCP-Server">
            <SelectValue placeholder={servers.isLoading ? "Lade Server …" : "Server wählen"} />
          </SelectTrigger>
          <SelectContent>
            {(servers.data ?? []).map((item) => (
              <SelectItem key={item.id} value={item.id}>
                {item.name}
              </SelectItem>
            ))}
            <SelectItem value="__new__">+ Neuen Server verbinden …</SelectItem>
          </SelectContent>
        </Select>

        <McpConnectDialog
          open={connectOpen}
          onOpenChange={setConnectOpen}
          onConnected={(created) =>
            patch({
              mcpServerId: created.id,
              mcpServerName: created.name,
              mcpTool: created.tools[0]?.name ?? "",
              lastError: null,
            })
          }
        />


        <Select
          value={config.tool}
          disabled={!config.serverId || tools.length === 0}
          onValueChange={(next) => patch({ mcpTool: next, lastError: null })}
        >
          <SelectTrigger className="nodrag h-8 text-xs" aria-label="Werkzeug">
            <SelectValue placeholder={tools.length ? "Werkzeug wählen" : "Keine Werkzeuge"} />
          </SelectTrigger>
          <SelectContent>
            {tools.map((item) => (
              <SelectItem key={item.name} value={item.name}>
                {item.title || item.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {tool?.description ? (
          <p className="line-clamp-2 text-[10px] text-muted-foreground">{tool.description}</p>
        ) : null}
      </div>

      <div className="module-heading flex items-center gap-2 border-b px-3 py-1.5">
        <Button
          size="sm"
          variant="secondary"
          className="nodrag h-7 rounded-full text-xs"
          disabled={running || !config.serverId || !config.tool}
          onClick={() => runMcp(record.id)}
        >
          <RefreshCw className={`mr-1 size-3 ${running ? "animate-spin" : ""}`} />
          {running ? "Führt aus …" : "Ausführen"}
        </Button>
        <span className="truncate text-[10px] text-muted-foreground">
          {config.lastError
            ? config.lastError
            : missing.length
              ? `Pflichtfeld offen: ${missing.join(", ")}`
              : config.lastAt
                ? new Date(config.lastAt).toLocaleString("de-DE")
                : config.serverId
                  ? "noch nicht ausgeführt"
                  : "kein Server gewählt"}
        </span>
      </div>

      <div className="flex items-center gap-1 border-b px-3 py-1 text-[10px]">
        {(
          [
            ["input", "Eingaben"],
            ["context", notes.length ? `Kontext (${notes.length})` : "Kontext"],
            ["output", "Ausgabe"],
            ["result", "Antwort"],
            ["history", history.length ? `Verlauf (${history.length})` : "Verlauf"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            className={`nodrag rounded-full px-2 py-0.5 ${
              section === key ? "bg-secondary text-foreground" : "text-muted-foreground"
            }`}
            onClick={() => setSection(key)}
          >
            {label}
          </button>
        ))}
      </div>

      {section === "input" ? (
        <div className="nowheel nodrag flex-1 space-y-2 overflow-auto px-3 py-2">
          {config.mode === "json" || (config.tool && fields.length === 0) ? (
            <Textarea
              key={record.id + "args"}
              defaultValue={config.args}
              rows={4}
              spellCheck={false}
              aria-label="Eingabewerte als JSON"
              placeholder={'{ "query": "Text" }'}
              className="nodrag nowheel min-h-[80px] font-mono text-[10px]"
              onBlur={(e) => patch({ mcpArgs: e.target.value })}
            />
          ) : fields.length === 0 ? (
            <p className="text-[10px] text-muted-foreground">
              Wähle ein Werkzeug – die Eingabefelder erscheinen dann automatisch.
            </p>
          ) : (
            fields.map((field) => {
              const bound = config.bindings[field.name] ?? "";
              return (
                <div key={field.name} className="grid gap-1">
                  <div className="flex items-baseline gap-1">
                    <span className="text-[10px] font-medium">{field.title}</span>
                    {field.required ? <span className="text-[10px] text-destructive">*</span> : null}
                    <span className="ml-auto font-mono text-[9px] text-muted-foreground">
                      {field.type}
                    </span>
                  </div>
                  {field.description ? (
                    <p className="line-clamp-2 text-[9px] text-muted-foreground">{field.description}</p>
                  ) : null}
                  {bound ? (
                    <p className="rounded-md bg-secondary px-2 py-1 text-[10px]">
                      Wert kommt aus „{linkable.find((item) => item.id === bound)?.title ?? "Modul"}“
                    </p>
                  ) : field.type === "enum" ? (
                    <Select
                      value={config.inputs[field.name] ?? ""}
                      onValueChange={(next) => setInput(field.name, next)}
                    >
                      <SelectTrigger className="nodrag h-7 text-xs" aria-label={field.title}>
                        <SelectValue placeholder="Auswahl" />
                      </SelectTrigger>
                      <SelectContent>
                        {field.options.map((option) => (
                          <SelectItem key={option} value={option}>
                            {option}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : field.type === "boolean" ? (
                    <Select
                      value={config.inputs[field.name] ?? ""}
                      onValueChange={(next) => setInput(field.name, next)}
                    >
                      <SelectTrigger className="nodrag h-7 text-xs" aria-label={field.title}>
                        <SelectValue placeholder="nicht gesetzt" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="true">ja</SelectItem>
                        <SelectItem value="false">nein</SelectItem>
                      </SelectContent>
                    </Select>
                  ) : (
                    <input
                      key={record.id + field.name}
                      defaultValue={config.inputs[field.name] ?? ""}
                      placeholder={field.placeholder}
                      aria-label={field.title}
                      inputMode={field.type === "number" || field.type === "integer" ? "decimal" : "text"}
                      className="nodrag h-7 w-full rounded-md border border-border/70 bg-background px-2 text-[11px] outline-none focus:border-ring"
                      onBlur={(e) => setInput(field.name, e.target.value)}
                    />
                  )}
                  {linkable.length > 0 ? (
                    <Select value={bound} onValueChange={(next) => setBinding(field.name, next === "__none__" ? "" : next)}>
                      <SelectTrigger
                        className="nodrag h-6 text-[10px] text-muted-foreground"
                        aria-label={`${field.title}: Wert aus Modul`}
                      >
                        <SelectValue placeholder="fester Wert" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">fester Wert</SelectItem>
                        {linkable.map((item) => (
                          <SelectItem key={item.id} value={item.id}>
                            {item.title || "Modul"}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : null}
                </div>
              );
            })
          )}
          <button
            type="button"
            className="nodrag text-[10px] underline text-muted-foreground"
            onClick={() => patch({ mcpMode: config.mode === "json" ? "form" : "json" })}
          >
            {config.mode === "json" ? "Geführte Felder verwenden" : "Als JSON bearbeiten"}
          </button>
        </div>
      ) : section === "context" ? (
        <div className="nowheel nodrag flex-1 space-y-2 overflow-auto px-3 py-2">
          {notes.length === 0 ? (
            <p className="text-[10px] text-muted-foreground">
              Verbinde eine Textkarte mit dieser Karte – ihr Inhalt steht dann hier als Kontext
              bereit und kann in jedes Eingabefeld übernommen werden.
            </p>
          ) : (
            notes.map((note) => {
              const choice = config.context[note.id] ?? "";
              const active = choice !== "off";
              const sections = markdownSections(note.content ?? "");
              const chosen = choice && choice !== "off" ? new Set(choice.split("|")) : null;
              const selectedText = contextTextFor(note, choice);
              return (
                <div key={note.id} className="rounded-md border border-border/70 px-2 py-1.5">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      aria-pressed={active}
                      className={`nodrag rounded-full px-2 py-0.5 text-[9px] ${
                        active ? "bg-secondary text-foreground" : "text-muted-foreground"
                      }`}
                      onClick={() => setContext(note.id, active ? "off" : "")}
                    >
                      {active ? "verwendet" : "aus"}
                    </button>
                    <span className="truncate text-[10px] font-medium">{note.title || "Text"}</span>
                    <button
                      type="button"
                      className="nodrag ml-auto rounded-full bg-secondary px-2 py-0.5 text-[9px]"
                      disabled={!selectedText}
                      onClick={() => {
                        const target = fields.find((field) => !config.bindings[field.name]);
                        if (!target) {
                          toast.info("Wähle zuerst ein Werkzeug mit Eingabefeldern");
                          return;
                        }
                        setInput(target.name, selectedText);
                        setSection("input");
                        toast.success(`Text in „${target.title}“ übernommen`);
                      }}
                    >
                      In Eingabe übernehmen
                    </button>
                  </div>
                  {active && sections.length > 1 ? (
                    <div className="mt-1 flex flex-wrap gap-1">
                      <button
                        type="button"
                        className={`nodrag rounded-full px-2 py-0.5 text-[9px] ${
                          chosen ? "text-muted-foreground" : "bg-secondary text-foreground"
                        }`}
                        onClick={() => setContext(note.id, "")}
                      >
                        ganzer Text
                      </button>
                      {sections.map((part) => {
                        const on = chosen?.has(part.title) ?? false;
                        return (
                          <button
                            key={part.title}
                            type="button"
                            className={`nodrag rounded-full px-2 py-0.5 text-[9px] ${
                              on ? "bg-secondary text-foreground" : "text-muted-foreground"
                            }`}
                            onClick={() => {
                              const next = new Set(chosen ?? []);
                              if (on) next.delete(part.title);
                              else next.add(part.title);
                              setContext(note.id, next.size ? [...next].join("|") : "");
                            }}
                          >
                            {part.title}
                          </button>
                        );
                      })}
                    </div>
                  ) : null}
                  {active ? (
                    <p className="mt-1 line-clamp-4 whitespace-pre-wrap text-[10px] text-muted-foreground">
                      {selectedText || "Keine Abschnitte gewählt."}
                    </p>
                  ) : null}
                </div>
              );
            })
          )}
        </div>
      ) : section === "history" ? (
        <div className="nowheel nodrag flex-1 space-y-2 overflow-auto px-3 py-2">
          {history.length === 0 ? (
            <p className="text-[10px] text-muted-foreground">
              Noch keine Ausführung. Nach jedem Lauf stehen hier Zeitpunkt, Eingaben und Antwort.
            </p>
          ) : (
            history.map((run, index) => (
              <div
                key={`${run.at}-${index}`}
                className="rounded-md border px-2 py-1.5"
                style={{ borderColor: run.ok ? "var(--border)" : "var(--signal-error, #de5a3a)" }}
              >
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-medium">
                    {new Date(run.at).toLocaleString("de-DE")}
                  </span>
                  <span className="truncate font-mono text-[9px] text-muted-foreground">
                    {run.tool}
                  </span>
                  <span
                    className="ml-auto text-[9px]"
                    style={{ color: run.ok ? "var(--signal-ok, #4f8a5b)" : "var(--signal-error, #de5a3a)" }}
                  >
                    {run.ok ? "erfolgreich" : "Fehler"}
                  </span>
                </div>
                {run.error ? (
                  <p className="mt-1 text-[10px]" style={{ color: "var(--signal-error, #de5a3a)" }}>
                    {run.error}
                  </p>
                ) : null}
                <p className="mt-1 break-all font-mono text-[9px] text-muted-foreground">
                  Eingaben: {run.args || "{}"}
                </p>
                {run.preview ? (
                  <pre className="mt-1 max-h-24 overflow-auto whitespace-pre-wrap break-words font-mono text-[9px] text-muted-foreground">
                    {run.preview}
                  </pre>
                ) : null}
              </div>
            ))
          )}
        </div>
      ) : section === "output" ? (
        <div className="nowheel nodrag flex-1 space-y-2 overflow-auto px-3 py-2">
          <div className="grid gap-1">
            <span className="text-[10px] font-medium">Feld für die Verbindung</span>
            <input
              key={record.id + config.pick}
              defaultValue={config.pick}
              placeholder="z. B. items.0.value"
              aria-label="Feld für die Verbindung"
              className="nodrag h-7 w-full rounded-md border border-border/70 bg-background px-2 font-mono text-[10px] outline-none focus:border-ring"
              onBlur={(e) => patch({ pick: e.target.value })}
            />
          </div>
          {paths.length > 0 ? (
            <div className="flex flex-wrap gap-1">
              {paths.map((path) => (
                <button
                  key={path}
                  type="button"
                  className="nodrag rounded-full bg-secondary px-2 py-0.5 font-mono text-[9px]"
                  onClick={() => patch({ pick: path })}
                >
                  {path}
                </button>
              ))}
            </div>
          ) : (
            <p className="text-[10px] text-muted-foreground">
              Führe das Werkzeug aus – danach schlägt die Karte passende Felder vor.
            </p>
          )}
          <p className="text-[10px] text-muted-foreground">
            Weitergegebener Wert:{" "}
            <span className="font-mono text-foreground">
              {value != null ? formatValue(value) : "–"}
            </span>
          </p>
        </div>
      ) : (
        <pre className="nowheel nodrag flex-1 overflow-auto whitespace-pre-wrap break-words px-3 py-2 font-mono text-[10px] leading-snug text-muted-foreground">
          {mcpPreview(record) || "Noch keine Antwort."}
        </pre>
      )}
    </div>
  );
});

/** Zeigt einen externen MCP-Server mit Status und Werkzeugliste; legt daraus Werkzeugkarten an. */
export const McpHubNode = memo(function McpHubNode({ data, selected }: NodeProps) {
  const record = (data as unknown as Data).record;
  const { updateNode, spawnMcpTool } = useBoard();
  const notes = contextCards(useConnectedRecords((data as unknown as Data).record.id));
  const meta = (record.metadata ?? {}) as Record<string, unknown>;
  const serverId = typeof meta["mcpServerId"] === "string" ? (meta["mcpServerId"] as string) : "";
  const [connectOpen, setConnectOpen] = useState(false);
  const [checking, setChecking] = useState(false);
  const [filter, setFilter] = useState("");
  const queryClient = useQueryClient();
  const servers = useQuery({
    queryKey: ["mcp-servers"],
    queryFn: () => listMcpServers(),
    staleTime: 60_000,
  });
  const server = servers.data?.find((item) => item.id === serverId);
  const tools = (server?.tools ?? []).filter((item) =>
    filter.trim()
      ? `${item.name} ${item.title ?? ""} ${item.description ?? ""}`
          .toLowerCase()
          .includes(filter.trim().toLowerCase())
      : true,
  );

  const status: "none" | "ok" | "error" | "stale" = !server
    ? "none"
    : server.lastError
      ? "error"
      : server.lastCheckAt
        ? "ok"
        : "stale";
  const statusColor =
    status === "ok"
      ? "var(--signal-ok, #4f8a5b)"
      : status === "error"
        ? "var(--signal-error, #de5a3a)"
        : "var(--signal-warn, #d97706)";
  const statusText =
    status === "none"
      ? "kein Server gewählt"
      : status === "error"
        ? (server?.lastError ?? "Fehler")
        : status === "ok"
          ? `geprüft ${new Date(server!.lastCheckAt!).toLocaleString("de-DE")}`
          : "noch nicht geprüft";

  function patch(next: Record<string, unknown>) {
    updateNode(record.id, { metadata: { ...(record.metadata ?? {}), ...next } });
  }

  async function check() {
    if (!serverId) return;
    setChecking(true);
    try {
      await refreshMcpServer({ data: { id: serverId } });
      await queryClient.invalidateQueries({ queryKey: ["mcp-servers"] });
    } catch (problem) {
      toast.error(problem instanceof Error ? problem.message : "Prüfung fehlgeschlagen");
    } finally {
      setChecking(false);
    }
  }

  return (
    <div
      className={`module-card flex h-full w-full flex-col overflow-hidden border bg-card ${
        selected ? "border-ring/60 shadow-[var(--shadow-float)]" : "border-border/70"
      }`}
      data-selected={Boolean(selected)}
      style={{ borderTop: `3px solid ${NODE_ACCENT["mcphub"] ?? "var(--primary)"}` }}
    >
      <NodeResizer isVisible={Boolean(selected)} minWidth={320} minHeight={280} />
      <SignalHandle type="target" position={Position.Left} />
      <SignalHandle type="source" position={Position.Right} />

      <div className="module-heading flex items-center gap-1.5 border-b px-3 py-2">
        <Plug className="size-3.5 shrink-0 text-muted-foreground" />
        <input
          key={record.id + (record.title ?? "")}
          defaultValue={record.title ?? "MCP-Hub"}
          className="nodrag min-w-0 flex-1 bg-transparent text-sm font-medium outline-none"
          onBlur={(e) => updateNode(record.id, { title: e.target.value.trim() || "MCP-Hub" })}
        />
        <span
          className="size-2 shrink-0 rounded-full"
          style={{ background: statusColor }}
          title={statusText}
        />
      </div>

      <div className="grid gap-1.5 border-b px-3 py-2">
        <Select
          value={serverId}
          onValueChange={(next) => {
            if (next === "__new__") {
              setConnectOpen(true);
              return;
            }
            const chosen = servers.data?.find((item) => item.id === next);
            patch({ mcpServerId: next, mcpServerName: chosen?.name ?? "" });
            if (chosen && (!record.title || record.title === "MCP-Hub")) {
              updateNode(record.id, { title: chosen.name });
            }
          }}
        >
          <SelectTrigger className="nodrag h-8 text-xs" aria-label="MCP-Server">
            <SelectValue placeholder={servers.isLoading ? "Lade Server …" : "Server wählen"} />
          </SelectTrigger>
          <SelectContent>
            {(servers.data ?? []).map((item) => (
              <SelectItem key={item.id} value={item.id}>
                {item.name}
              </SelectItem>
            ))}
            <SelectItem value="__new__">+ Neuen Server verbinden …</SelectItem>
          </SelectContent>
        </Select>

        <McpConnectDialog
          open={connectOpen}
          onOpenChange={setConnectOpen}
          onConnected={(created) => {
            patch({ mcpServerId: created.id, mcpServerName: created.name });
            updateNode(record.id, { title: created.name });
          }}
        />

        {server ? (
          <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 font-mono text-[10px] text-muted-foreground">
            <dt>Adresse</dt>
            <dd className="truncate text-foreground">{server.url}</dd>
            <dt>Dienst</dt>
            <dd className="truncate">{server.serverName || "unbekannt"}</dd>
            <dt>Anmeldung</dt>
            <dd>
              {server.authKind === "none"
                ? "offen"
                : server.authKind === "bearer"
                  ? "Zugangsschlüssel"
                  : `Kopffeld ${server.headerName ?? ""}`}
              {server.hasToken ? " · hinterlegt" : ""}
            </dd>
            <dt>Werkzeuge</dt>
            <dd>{server.tools.length}</dd>
          </dl>
        ) : null}
      </div>

      <div className="module-heading flex items-center gap-2 border-b px-3 py-1.5">
        <Button
          size="sm"
          variant="secondary"
          className="nodrag h-7 rounded-full text-xs"
          disabled={!serverId || checking}
          onClick={() => void check()}
        >
          <RefreshCw className={`mr-1 size-3 ${checking ? "animate-spin" : ""}`} />
          {checking ? "Prüft …" : "Prüfen"}
        </Button>
        <span className="truncate text-[10px]" style={{ color: statusColor }}>
          {statusText}
        </span>
      </div>

      {notes.length > 0 ? (
        <div className="nowheel border-b px-3 py-1.5">
          <p className="text-[10px] font-medium text-muted-foreground">
            Kontext aus {notes.length} Textkarte{notes.length === 1 ? "" : "n"}
          </p>
          <p className="line-clamp-3 whitespace-pre-wrap text-[10px] text-muted-foreground">
            {notes.map((note) => note.content).join(" · ")}
          </p>
        </div>
      ) : null}

      {server && server.tools.length > 3 ? (
        <div className="border-b px-3 py-1.5">
          <input
            value={filter}
            placeholder="Werkzeug suchen"
            aria-label="Werkzeug suchen"
            className="nodrag w-full rounded-md border border-border/70 bg-transparent px-2 py-1 text-[11px] outline-none"
            onChange={(e) => setFilter(e.target.value)}
          />
        </div>
      ) : null}

      <ul className="nowheel nodrag flex-1 divide-y overflow-auto">
        {tools.map((item) => (
          <li key={item.name} className="flex items-start gap-2 px-3 py-2">
            <div className="min-w-0 flex-1">
              <p className="truncate font-mono text-[11px] text-foreground">
                {item.title || item.name}
              </p>
              {item.description ? (
                <p className="line-clamp-2 text-[10px] text-muted-foreground">{item.description}</p>
              ) : null}
            </div>
            <Button
              size="sm"
              variant="ghost"
              className="nodrag h-6 shrink-0 rounded-full px-2 text-[10px]"
              onClick={() => spawnMcpTool(record.id, server!.id, server!.name, item.name)}
            >
              <Plus className="mr-0.5 size-3" />
              Karte
            </Button>
          </li>
        ))}
        {server && tools.length === 0 ? (
          <li className="px-3 py-3 text-[11px] text-muted-foreground">
            Keine Werkzeuge gefunden – prüfe die Verbindung.
          </li>
        ) : null}
        {!server ? (
          <li className="px-3 py-3 text-[11px] text-muted-foreground">
            Wähle oben einen Server oder verbinde einen neuen Dienst.
          </li>
        ) : null}
      </ul>
    </div>
  );
});
