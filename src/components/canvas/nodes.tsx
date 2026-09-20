import { memo, useEffect, useMemo, useRef, useState } from "react";
import { Handle, NodeResizer, Position, type NodeProps } from "@xyflow/react";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ZONE_WHITE } from "@/lib/templates";
import { NODE_ACCENT, NODE_LABEL, useBoard, type NodeRecord } from "./board-context";

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
        <button
          className="nodrag text-xs text-muted-foreground hover:text-destructive"
          onClick={() => deleteNode(record.id)}
          title="Modul löschen"
        >
          ✕
        </button>
      </div>
      {zone && (
        <button
          className="nodrag mt-1.5 flex items-center gap-1.5 text-[10px] text-muted-foreground hover:text-foreground"
          onClick={() => openInspector(record.id, "assign")}
          title="Zuordnung bearbeiten"
        >
          <span
            className="h-2 w-2 rounded-full"
            style={{ background: zone.color ?? "var(--primary)" }}
          />
          {zone.title} · {zone.role}
        </button>
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
            {record.content?.slice(0, 4000) || "Kein Text gefunden."}
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

export const ZONE_COLORS = [
  ZONE_WHITE,
  "var(--frame)",
  "var(--video)",
  "var(--audio)",
  "var(--doc)",
  "var(--note)",
  "var(--chat)",
] as const;

export const ZoneNode = memo(function ZoneNode({ data, selected }: NodeProps) {
  const record = (data as unknown as Data).record;
  const { updateNode, resizeZone } = useBoard();
  const color = record.color ?? ZONE_WHITE;
  const meta = (record.metadata ?? {}) as Record<string, unknown>;
  const isGroup = meta["templateGroup"] === true;
  return (
    <>
      <NodeResizer
        minWidth={160}
        minHeight={120}
        isVisible={Boolean(selected)}
        color="var(--primary)"
        onResizeEnd={(_, params) => resizeZone(record.id, params.width, params.height)}
      />
      <div
        className={`h-full w-full rounded-2xl border${isGroup ? " border-dashed" : ""}`}
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
          onBlur={(e) => updateNode(record.id, { title: e.target.value })}
          className="nodrag w-full bg-transparent px-4 py-2.5 font-display text-sm font-semibold tracking-wide text-muted-foreground uppercase outline-none"
        />
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
  const { collectContext, addNoteFrom } = useBoard();
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
