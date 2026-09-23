/**
 * Quellen-Karte: eine Quelle ist eine Quelle ist eine Quelle.
 *
 * Tabelle, Regelwerk, Notiz oder Beleg — alles fällt in dieselbe Karte,
 * läuft durch dieselbe Aufnahme und zeigt denselben Zustand: Datenumfang,
 * Vollständigkeit und – sobald ein Regelwerk angeschlossen ist – Befunde
 * im Klartext. Die Karte warnt, sie blockiert nie.
 */
import { memo, useMemo, useRef, useState } from "react";
import { NodeResizer, Position, useStore, type NodeProps } from "@xyflow/react";
import { FileUp, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useBoard, type NodeRecord } from "./board-context";
import { SignalHandle } from "./nodes";
import { ingestFile, ingestText } from "@/lib/runtime/ingestion";
import { primaryFacet } from "@/lib/runtime/source-protocol";
import { evaluateSignal, signalTone, type SignalStatus } from "@/lib/runtime/signal-engine";
import { FACET_LABEL, readOntology, readSource, sourceSummary, trimEnvelope } from "@/lib/source-node";

const TONE_COLOR: Record<ReturnType<typeof signalTone>, string> = {
  positive: "var(--sage, #598381)",
  caution: "var(--warning, #E0682B)",
  critical: "var(--destructive)",
  muted: "var(--muted-foreground)",
};

const STATUS_LABEL: Record<SignalStatus, string> = {
  ok: "Geprüft",
  warn: "Mit Lücken",
  violation: "Regelverstoß",
  idle: "Keine Daten",
};

/** Regelwerke, die auf diese Karte zeigen. */
function useUpstreamOntologies(nodeId: string) {
  const records = useStore((store) => {
    const found: NodeRecord[] = [];
    for (const edge of store.edges) {
      if (edge.target !== nodeId) continue;
      const record = (store.nodeLookup.get(edge.source)?.data as { record?: NodeRecord } | undefined)
        ?.record;
      if (record) found.push(record);
    }
    return found;
  }, (a, b) => a.length === b.length && a.every((item, i) => item.id === b[i]?.id && item.metadata === b[i]?.metadata));

  return useMemo(
    () => records.map((record) => readOntology(record)).filter((item) => item != null),
    [records],
  );
}

export const SourceNode = memo(function SourceNode({ id, data, selected }: NodeProps) {
  const record = (data as unknown as { record: NodeRecord }).record;
  const { updateNode, deleteNode } = useBoard();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);

  const stored = readSource(record);
  const ontologies = useUpstreamOntologies(id);
  const ownOntology = readOntology(record);

  const signal = useMemo(
    () =>
      evaluateSignal({
        envelope: stored?.envelope ?? null,
        ontology: ontologies[0] ?? null,
      }),
    [stored, ontologies],
  );

  async function take(input: File | string) {
    console.log("[Quelle] take", typeof input === "string" ? "text" : input.name);
    setBusy(true);
    try {
      const envelope =
        typeof input === "string"
          ? ingestText(input, { sourceName: "Eingefügter Inhalt", originKind: "text" })
          : await ingestFile(input);
      const source = trimEnvelope(envelope);
      updateNode(record.id, {
        title: envelope.meta.sourceName,
        metadata: { ...(record.metadata ?? {}), source },
      });
    } catch (error) {
      console.error("Quelle konnte nicht gelesen werden", error);
      toast.error("Inhalt konnte nicht gelesen werden.");
    } finally {
      setBusy(false);
    }
  }

  const facet = stored ? primaryFacet(stored.envelope) : null;
  const tone = TONE_COLOR[signalTone(signal.status)];
  const findings = signal.findings.filter((item) => item.status !== "pass").slice(0, 3);

  return (
    <div
      className={`module-card flex h-full w-full flex-col overflow-hidden border bg-card ${
        selected ? "border-ring/60 shadow-[var(--shadow-float)]" : "border-border/70"
      }`}
      data-selected={Boolean(selected)}
      style={{ borderTop: `3px solid ${tone}` }}
      onDragOver={(event) => {
        event.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(event) => {
        event.preventDefault();
        event.stopPropagation();
        setOver(false);
        const file = event.dataTransfer.files?.[0];
        const text = event.dataTransfer.getData("text/plain");
        if (file) void take(file);
        else if (text.trim()) void take(text);
      }}
    >
      <NodeResizer isVisible={Boolean(selected)} minWidth={280} minHeight={200} />
      <SignalHandle type="target" position={Position.Left} />
      <SignalHandle type="source" position={Position.Right} />

      <div className="module-heading flex items-center gap-2 border-b px-3 py-2">
        <span
          className="rounded-md px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-white"
          style={{ background: tone }}
        >
          {ownOntology ? "Regelwerk" : facet ? FACET_LABEL[facet] : "Quelle"}
        </span>
        <span className="line-clamp-1 flex-1 text-sm font-medium">{record.title || "Quelle"}</span>
        <button
          className="nodrag flex size-6 items-center justify-center rounded-full text-xs text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
          onClick={() => deleteNode(record.id)}
          aria-label="Modul löschen"
        >
          ✕
        </button>
      </div>

      <div className="nowheel flex-1 overflow-auto px-3 py-2 text-xs">
        {!stored ? (
          <div
            className={`flex h-full flex-col items-center justify-center rounded-lg border border-dashed px-3 py-6 text-center ${
              over ? "border-ring bg-accent/40" : "border-border"
            }`}
          >
            {busy ? (
              <Loader2 className="size-5 animate-spin text-muted-foreground" />
            ) : (
              <>
                <FileUp className="size-5 text-muted-foreground" />
                <p className="mt-2 text-sm font-medium">Datei hierher ziehen</p>
                <p className="mt-1 text-muted-foreground">
                  Tabelle, Liste, Regelwerk, Notiz oder Beleg – alles wird gelesen.
                </p>
                <button
                  className="nodrag mt-3 rounded-md border px-2 py-1 hover:bg-accent"
                  onClick={() => fileRef.current?.click()}
                >
                  Datei auswählen
                </button>
              </>
            )}
          </div>
        ) : (
          <>
            <p className="font-medium">{sourceSummary(stored)}</p>
            <p className="mt-0.5 text-muted-foreground">
              {stored.envelope.meta.sourceName}
              {stored.envelope.meta.container ? ` · ${stored.envelope.meta.container}` : ""}
            </p>

            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <span
                className="rounded-full px-2 py-0.5 text-[10px] font-medium text-white"
                style={{ background: tone }}
              >
                {STATUS_LABEL[signal.status]}
              </span>
              <span className="rounded-full border px-2 py-0.5 text-[10px] text-muted-foreground">
                Vollständig {Math.round(stored.envelope.quality.completeness * 100)} %
              </span>
              <span className="rounded-full border px-2 py-0.5 text-[10px] text-muted-foreground">
                Sicherheit {Math.round(stored.envelope.quality.confidence * 100)} %
              </span>
              {ownOntology ? (
                <span className="rounded-full border px-2 py-0.5 text-[10px] text-muted-foreground">
                  {ownOntology.rules.length} Regeln
                </span>
              ) : null}
            </div>

            <div className="mt-2 rounded-md bg-muted/50 px-2 py-1.5">
              <p className="font-medium">{signal.explanation.headline}</p>
              {signal.explanation.cause ? (
                <p className="mt-0.5 text-muted-foreground">{signal.explanation.cause}</p>
              ) : null}
              {signal.explanation.remedy ? (
                <p className="mt-0.5 text-muted-foreground">→ {signal.explanation.remedy}</p>
              ) : null}
            </div>

            {findings.length ? (
              <ul className="mt-2 space-y-1">
                {findings.map((finding) => (
                  <li key={finding.ruleId} className="rounded-md border px-2 py-1">
                    <span
                      className="mr-1 inline-block size-2 rounded-full align-middle"
                      style={{
                        background:
                          finding.status === "violation"
                            ? TONE_COLOR.critical
                            : finding.status === "warn"
                              ? TONE_COLOR.caution
                              : TONE_COLOR.muted,
                      }}
                    />
                    {finding.message}
                    {finding.row ? (
                      <span className="text-muted-foreground"> (Zeile {finding.row})</span>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : null}

            {stored.envelope.quality.anomalies.length ? (
              <ul className="mt-2 list-disc pl-4 text-muted-foreground">
                {stored.envelope.quality.anomalies.slice(0, 3).map((note) => (
                  <li key={note}>{note}</li>
                ))}
              </ul>
            ) : null}

            <button
              className="nodrag mt-2 rounded-md border px-2 py-1 hover:bg-accent"
              onClick={() => fileRef.current?.click()}
            >
              Quelle ersetzen
            </button>
          </>
        )}

        <input
          ref={fileRef}
          type="file"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) void take(file);
          }}
        />
      </div>
    </div>
  );
});
