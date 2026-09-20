import { memo, useEffect, useRef, useState } from "react";
import { Handle, NodeResizer, Position, type NodeProps } from "@xyflow/react";
import { toast } from "sonner";
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

type Data = { record: NodeRecord };

function Shell({
  type,
  children,
  selected,
  minWidth = 240,
  minHeight = 160,
}: {
  type: string;
  children: React.ReactNode;
  selected?: boolean;
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
      <Handle type="target" position={Position.Left} />
      <div
        className="flex h-full w-full flex-col overflow-hidden rounded-2xl border bg-card shadow-[var(--shadow-card)]"
        style={{ borderTop: `3px solid ${NODE_ACCENT[type] ?? "var(--primary)"}` }}
      >
        {children}
      </div>
      <Handle type="source" position={Position.Right} />
    </>
  );
}

function Header({ record }: { record: NodeRecord }) {
  const { deleteNode } = useBoard();
  return (
    <div className="flex items-start gap-2 border-b px-3 py-2">
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
  );
}

export const ContentNode = memo(function ContentNode({ data, selected }: NodeProps) {
  const record = (data as unknown as Data).record;
  const thumbnail = (record.metadata?.["thumbnail"] as string | undefined) ?? null;

  return (
    <Shell type={record.type} selected={selected}>
      <Header record={record} />
      {thumbnail && (
        <img src={thumbnail} alt="" className="h-28 w-full object-cover" draggable={false} />
      )}
      <div className="nowheel flex-1 overflow-auto px-3 py-2 text-xs leading-relaxed text-muted-foreground">
        {record.status === "processing" && (
          <p className="animate-pulse text-foreground">Inhalt wird verarbeitet …</p>
        )}
        {record.status === "error" && <p className="text-destructive">{record.error}</p>}
        {record.status === "ready" && (
          <p className="whitespace-pre-wrap">{record.content?.slice(0, 4000) || "Kein Text gefunden."}</p>
        )}
      </div>
      <div className="flex items-center justify-between border-t px-3 py-1.5 text-[11px] text-muted-foreground">
        <span>{record.content ? `${record.content.length.toLocaleString("de-DE")} Zeichen` : "—"}</span>
        {record.source_url && (
          <a
            className="nodrag hover:text-foreground hover:underline"
            href={record.source_url}
            target="_blank"
            rel="noreferrer"
          >
            Quelle öffnen
          </a>
        )}
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
    <Shell type="note" selected={selected}>
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
    <Shell type="chat" selected={selected} minWidth={320} minHeight={320}>
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
