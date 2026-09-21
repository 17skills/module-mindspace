import { memo, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { BookOpen, Lock, RotateCw, ShieldOff } from "lucide-react";
import {
  BaseEdge,
  EdgeLabelRenderer,
  Handle,
  NodeResizer,
  Position,
  getBezierPath,
  useEdges,
  type EdgeProps,
  type NodeProps,
} from "@xyflow/react";
import { calcInputs, evalFormula, formatValue } from "@/lib/calc";
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
  const { updateNode, resizeZone } = useBoard();
  const color = record.color ?? ZONE_WHITE;
  const meta = (record.metadata ?? {}) as Record<string, unknown>;
  const isGroup = meta["templateGroup"] === true;
  const locked = meta["locked"] === true;
  return (
    <>
      <NodeResizer
        minWidth={160}
        minHeight={120}
        isVisible={Boolean(selected) && !locked}
        color="var(--primary)"
        onResizeEnd={(_, params) => resizeZone(record.id, params.width, params.height)}
      />
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
          <div className="nodrag nowheel min-h-0 flex-1 p-2">
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
        <ul className="nowheel nodrag flex-1 space-y-1 overflow-auto px-4 py-2 text-xs">
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
                className="flex-1 bg-transparent outline-none"
              />
            </li>
          ))}
          {rows.length === 0 && <li className="text-muted-foreground">Keine Einträge</li>}
        </ul>
      )}

      {type === "table" && (
        <div className="nowheel nodrag flex-1 overflow-auto">
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
                        className="w-full bg-transparent outline-none"
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

      <div ref={scrollRef} className="nowheel nodrag flex-1 space-y-2 overflow-auto px-3 py-2">
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
  const { updateEdge } = useBoard();
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
            <input
              key={label}
              autoFocus
              defaultValue={label}
              placeholder="z. B. 25 %"
              aria-label="Wert der Verbindung"
              className="h-6 w-20 rounded-md border border-border bg-card text-center text-[11px] shadow-sm outline-none focus:ring-2 focus:ring-ring/50"
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
  const { updateNode, allNodes, focusNode } = useBoard();
  const edges = useEdges();
  const records = useMemo(
    () => Object.fromEntries(allNodes().map((r) => [r.id, r])),
    // recompute whenever any module changes (allNodes reads the live store)
    [allNodes, edges, record],
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
      <div className="nodrag nowheel flex-1 space-y-1 overflow-auto px-3 py-2">
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
              className="min-w-0 flex-1 truncate text-left hover:underline"
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
                className="w-16 shrink-0 rounded-md border border-transparent bg-transparent px-1 text-right font-mono outline-none hover:border-border focus:border-border focus:bg-background"
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
