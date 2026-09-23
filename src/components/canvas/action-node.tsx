/**
 * Aktions-Karte mit Ablagefach.
 *
 * Sie führt nichts aus. Sie beschreibt eine Wirkung vollständig, friert sie
 * ein und legt sie ins Ablagefach. Erst die Freigabe eines Menschen — mit
 * Begründung, wenn die Grundlage Lücken hat oder die Wirkung unumkehrbar ist —
 * markiert sie als beschlossen. Jede Entscheidung bleibt protokolliert.
 */
import { memo, useEffect, useMemo, useState } from "react";
import { NodeResizer, Position, useStore, type NodeProps } from "@xyflow/react";
import { Send } from "lucide-react";
import { useBoard, type NodeRecord } from "./board-context";
import { SignalHandle } from "./nodes";
import { useAuth } from "@/hooks/useAuth";
import { evaluateSignal, signalTone, type SignalStatus } from "@/lib/runtime/signal-engine";
import { readOntology, readSource } from "@/lib/source-node";
import { runEvaluate, stageEffect } from "@/lib/runtime/unit-spec";
import {
  ACTION_CHANNELS,
  actionUnit,
  channelSpec,
  discardEffect,
  needsJustification,
  readAction,
  releaseEffect,
  stagingBrief,
  toStaged,
  type ActionBasis,
  type ActionState,
  type StagedEffect,
} from "@/lib/runtime/staging";

const TONE_COLOR: Record<ReturnType<typeof signalTone>, string> = {
  positive: "var(--sage, #598381)",
  caution: "var(--warning, #E0682B)",
  critical: "var(--destructive)",
  muted: "var(--muted-foreground)",
};

const STATE_LABEL: Record<StagedEffect["state"], string> = {
  staged: "Wartet auf Freigabe",
  released: "Freigegeben",
  discarded: "Verworfen",
};

const spec = actionUnit();

/** Karten, die auf diese Aktion zeigen — sie bilden die Grundlage. */
function useBasis(nodeId: string): ActionBasis[] {
  const records = useStore(
    (store) => {
      const found: NodeRecord[] = [];
      for (const edge of store.edges) {
        if (edge.target !== nodeId) continue;
        const record = (store.nodeLookup.get(edge.source)?.data as { record?: NodeRecord } | undefined)
          ?.record;
        if (record) found.push(record);
      }
      return found;
    },
    (a, b) =>
      a.length === b.length &&
      a.every((item, i) => item.id === b[i]?.id && item.content === b[i]?.content && item.metadata === b[i]?.metadata),
  );

  return useMemo(
    () =>
      records.map((record) => {
        const stored = readSource(record);
        const status: SignalStatus = stored
          ? evaluateSignal({ envelope: stored.envelope, ontology: readOntology(record) }).status
          : record.content?.trim()
            ? "ok"
            : "idle";
        return {
          unitId: record.id,
          title: record.title ?? "Karte",
          brief: (record.content ?? "").slice(0, 2000),
          status,
        };
      }),
    [records],
  );
}

export const ActionNode = memo(function ActionNode({ id, data, selected }: NodeProps) {
  const record = (data as unknown as { record: NodeRecord }).record;
  const { updateNode, deleteNode } = useBoard();
  const { user } = useAuth();
  const who = user?.email ?? "Unbekannt";

  const stored = readAction(record.metadata);
  const basis = useBasis(id);
  const [note, setNote] = useState("");

  const state: ActionState = useMemo(() => ({ config: stored.config, basis }), [stored.config, basis]);
  const result = useMemo(() => runEvaluate(spec, { ports: {} }, state), [state]);
  const tone = TONE_COLOR[signalTone(result.status)];
  const channel = channelSpec(stored.config.channel);

  function save(patch: Partial<typeof stored.config>, effects = stored.effects) {
    updateNode(record.id, {
      metadata: {
        ...(record.metadata ?? {}),
        action: { config: { ...stored.config, ...patch }, effects },
      },
    });
  }

  function stage() {
    const proposal = stageEffect(spec, result, state);
    if (!proposal) return;
    save({}, [toStaged(proposal), ...stored.effects].slice(0, 20));
  }

  function decide(effect: StagedEffect, release: boolean) {
    const next = release ? releaseEffect(effect, who, note) : discardEffect(effect, who, note);
    setNote("");
    save({}, stored.effects.map((item) => (item.id === effect.id ? next : item)));
  }

  /** Protokoll als Karteninhalt: so liest Chat und Freigabe-Prüfung mit. */
  const brief = useMemo(() => stagingBrief(stored), [stored]);
  useEffect(() => {
    if (brief !== (record.content ?? "")) updateNode(record.id, { content: brief });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brief]);

  const open = stored.effects.filter((item) => item.state === "staged");

  return (
    <div
      className={`module-card flex h-full w-full flex-col overflow-hidden border bg-card ${
        selected ? "border-ring/60 shadow-[var(--shadow-float)]" : "border-border/70"
      }`}
      data-selected={Boolean(selected)}
      style={{ borderTop: `3px solid ${tone}` }}
    >
      <NodeResizer isVisible={Boolean(selected)} minWidth={320} minHeight={280} />
      <SignalHandle type="target" position={Position.Left} />
      <SignalHandle type="source" position={Position.Right} />

      <div className="module-heading flex items-center gap-2 border-b px-3 py-2">
        <span
          className="rounded-md px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-white"
          style={{ background: tone }}
        >
          Aktion
        </span>
        <span className="line-clamp-1 flex-1 text-sm font-medium">{record.title || "Aktion"}</span>
        {open.length ? (
          <span className="rounded-full border px-2 py-0.5 text-[10px] text-muted-foreground">
            {open.length} offen
          </span>
        ) : null}
        <button
          className="nodrag flex size-6 items-center justify-center rounded-full text-xs text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
          onClick={() => deleteNode(record.id)}
          aria-label="Modul löschen"
        >
          ✕
        </button>
      </div>

      <div className="nowheel flex-1 space-y-2 overflow-auto px-3 py-2 text-xs">
        <div className="flex flex-wrap gap-1.5">
          {ACTION_CHANNELS.map((item) => (
            <button
              key={item.id}
              className={`nodrag rounded-full border px-2 py-0.5 text-[11px] ${
                item.id === stored.config.channel ? "border-ring bg-accent" : "hover:bg-accent/60"
              }`}
              onClick={() => save({ channel: item.id })}
            >
              {item.label}
            </button>
          ))}
        </div>

        <input
          className="nodrag w-full rounded-md border bg-background px-2 py-1"
          placeholder="Was geschähe? z. B. Betriebsleitung informieren"
          value={stored.config.summary}
          onChange={(event) => save({ summary: event.target.value })}
        />
        <input
          className="nodrag w-full rounded-md border bg-background px-2 py-1"
          placeholder={channel.recipientLabel}
          value={stored.config.recipient}
          onChange={(event) => save({ recipient: event.target.value })}
        />
        <textarea
          className="nodrag h-14 w-full resize-none rounded-md border bg-background px-2 py-1"
          placeholder="Zusatz (frei, optional)"
          value={stored.config.message}
          onChange={(event) => save({ message: event.target.value })}
        />

        <div className="rounded-md bg-muted/50 px-2 py-1.5">
          <p className="font-medium">{result.signal.explanation.headline}</p>
          {result.signal.explanation.cause ? (
            <p className="mt-0.5 line-clamp-2 text-muted-foreground">{result.signal.explanation.cause}</p>
          ) : null}
          <p className="mt-0.5 text-muted-foreground">
            Grundlage: {basis.length ? `${basis.length} verbundene Karte(n)` : "keine verbunden"}
          </p>
        </div>

        <button
          className="nodrag flex w-full items-center justify-center gap-1.5 rounded-md border px-2 py-1.5 font-medium disabled:opacity-50"
          disabled={!result.output}
          onClick={stage}
        >
          <Send className="size-3.5" /> Wirkung ins Ablagefach legen
        </button>

        {stored.effects.length ? (
          <div className="space-y-1.5">
            <p className="font-semibold">Ablagefach</p>
            {stored.effects.map((effect) => (
              <div key={effect.id} className="rounded-md border px-2 py-1.5">
                <div className="flex items-center gap-1.5">
                  <span
                    className="inline-block size-2 shrink-0 rounded-full"
                    style={{ background: TONE_COLOR[signalTone(effect.status)] }}
                  />
                  <span className="line-clamp-1 flex-1 font-medium">{effect.summary}</span>
                  <span className="text-[10px] text-muted-foreground">{effect.channel}</span>
                </div>
                <p className="mt-0.5 text-muted-foreground">{effect.caution}</p>
                <p className="mt-0.5 text-[10px] text-muted-foreground">
                  {STATE_LABEL[effect.state]}
                  {effect.decidedBy ? ` · ${effect.decidedBy}` : ""}
                  {effect.note ? ` · ${effect.note}` : ""}
                </p>
                {effect.state === "staged" ? (
                  <>
                    {needsJustification(effect) ? (
                      <input
                        className="nodrag mt-1 w-full rounded-md border bg-background px-2 py-1"
                        placeholder="Begründung (erforderlich)"
                        value={note}
                        onChange={(event) => setNote(event.target.value)}
                      />
                    ) : null}
                    <div className="mt-1 flex gap-1.5">
                      <button
                        className="nodrag rounded-md border px-2 py-1 font-medium hover:bg-accent disabled:opacity-50"
                        disabled={needsJustification(effect) && !note.trim()}
                        onClick={() => decide(effect, true)}
                      >
                        Freigeben
                      </button>
                      <button
                        className="nodrag rounded-md border px-2 py-1 text-muted-foreground hover:bg-accent"
                        onClick={() => decide(effect, false)}
                      >
                        Verwerfen
                      </button>
                    </div>
                  </>
                ) : null}
              </div>
            ))}
          </div>
        ) : (
          <p className="text-muted-foreground">
            Noch nichts im Ablagefach. Nichts verlässt diese Karte ohne Ihre Freigabe.
          </p>
        )}
      </div>
    </div>
  );
});
