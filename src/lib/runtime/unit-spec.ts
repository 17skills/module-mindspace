/**
 * Modul-Vertrag (Unit Spec).
 *
 * Jede Kachel auf dem Canvas — Quelle, Rechnung, Regelwerk, Risiko,
 * Entscheidung, Aktion — erfüllt denselben Vertrag mit drei Ebenen:
 *
 *  1. evaluate      — sofort, rein, ohne Seiteneffekt. Läuft bei jeder Änderung.
 *  2. execute       — langsam (Netz, KI, Datei). Läuft nur auf Anstoß.
 *  3. prepareEffect — Wirkung nach außen. Erzeugt NUR einen Vorschlag,
 *                     der im Ablagefach liegt, bis ein Mensch freigibt.
 *
 * Invarianten:
 *  - Ein Modul feuert nie selbst nach außen. prepareEffect beschreibt, es handelt nicht.
 *  - Fehlende Eingänge sind kein Absturz: das Ergebnis trägt ein Signal mit Klartext.
 *  - Zwischen Modulen fließen typisierte Werte, nie Fließtext.
 */
import type { SourceEnvelope } from "@/lib/runtime/source-protocol";
import {
  aggregateSignals,
  evaluateSignal,
  worstStatus,
  type PortFacet,
  type Signal,
  type SignalStatus,
} from "@/lib/runtime/signal-engine";
import type { Ontology } from "@/lib/runtime/rule-ontology";

/** Die drei Archetypen: woher etwas kommt, was daraus folgt, was danach geschieht. */
export type UnitKind = "source" | "logic" | "action";

export interface PortSpec {
  id: string;
  label: string;
  /** Welche Facetten dieser Eingang versteht. "any" nimmt alles. */
  accepts: PortFacet[];
  /** Ohne diesen Eingang kann das Modul nicht rechnen. */
  required?: boolean;
}

export interface UnitInput {
  /** Eingänge nach Port-Id: was gerade an diesem Eingang anliegt. */
  ports: Record<string, SourceEnvelope | null>;
  /** Optionale Leitplanken aus verbundenen Regelwerken. */
  ontology?: Ontology | null;
}

/** Ergebnis von evaluate/execute: immer Wert + Zustand, nie nur Wert. */
export interface UnitResult<TOutput> {
  status: SignalStatus;
  /** Null, solange kein belastbares Ergebnis vorliegt. */
  output: TOutput | null;
  signal: Signal;
  /** Klartext-Begründung für Menschen, zeilenweise. */
  notes: string[];
}

/**
 * Vorbereitete Wirkung nach außen. Sie liegt im Ablagefach und wird
 * ausschließlich durch eine menschliche Freigabe ausgeführt.
 */
export interface EffectProposal {
  id: string;
  unitId: string;
  /** Was geschähe, in einem Satz: "E-Mail an Betriebsleitung senden". */
  summary: string;
  channel: string;
  /** Vollständige, eingefrorene Nutzlast — nach Freigabe unverändert ausgeführt. */
  payload: Record<string, unknown>;
  /** Warum das Modul das vorschlägt. */
  rationale: string;
  /** Zustand der Datengrundlage zum Zeitpunkt des Vorschlags. */
  status: SignalStatus;
  /** Unumkehrbare Wirkung (Zahlung, Abschaltung, Versand an Dritte). */
  irreversible: boolean;
  preparedAt: string;
}

export interface UnitSpec<TOutput, TState = unknown> {
  kind: UnitKind;
  /** Stabiler Typ-Schlüssel, z. B. "risk.iso55001". */
  type: string;
  label: string;
  inputs: PortSpec[];
  /** Welche Facette dieses Modul weitergibt; null = gibt nichts weiter. */
  emits: PortFacet | null;
  /** Sofort, rein, ohne Seiteneffekt. */
  evaluate: (input: UnitInput, state: TState) => UnitResult<TOutput>;
  /** Langsame Arbeit auf Anstoß. Ohne Angabe genügt evaluate. */
  execute?: (input: UnitInput, state: TState) => Promise<UnitResult<TOutput>>;
  /** Beschreibt eine Wirkung — führt sie niemals aus. */
  prepareEffect?: (result: UnitResult<TOutput>, state: TState) => EffectProposal | null;
}

/** Zustand aller Eingänge eines Moduls, inklusive fehlender Pflicht-Eingänge. */
export function inputSignal(spec: UnitSpec<unknown, never>, input: UnitInput): Signal {
  const signals = spec.inputs.map((port) =>
    evaluateSignal({
      envelope: input.ports[port.id] ?? null,
      accepts: port.accepts,
      ontology: input.ontology ?? null,
    }),
  );
  if (!signals.length) return evaluateSignal({ envelope: null });
  return aggregateSignals(signals);
}

/** Pflicht-Eingänge, an denen noch nichts anliegt. */
export function missingInputs(spec: UnitSpec<unknown, never>, input: UnitInput): PortSpec[] {
  return spec.inputs.filter((port) => port.required && !input.ports[port.id]);
}

/** Ergebnis-Hülle für "kann noch nicht rechnen" — nie ein Absturz. */
export function pending(reason: string, remedy: string): UnitResult<never> {
  return {
    status: "idle",
    output: null,
    signal: {
      status: "idle",
      display: "—",
      confidence: 0,
      completeness: 0,
      findings: [],
      facet: null,
      explanation: { headline: "Noch nichts zu rechnen", cause: reason, remedy },
    },
    notes: [reason],
  };
}

/**
 * Führt evaluate aus und hält den Vertrag ein: fehlt ein Pflicht-Eingang,
 * kommt ein erklärtes Wartezeichen statt eines Fehlers.
 */
export function runEvaluate<TOutput, TState>(
  spec: UnitSpec<TOutput, TState>,
  input: UnitInput,
  state: TState,
): UnitResult<TOutput> {
  const missing = missingInputs(spec as unknown as UnitSpec<unknown, never>, input);
  if (missing.length) {
    return pending(
      `${missing.map((port) => port.label).join(" und ")} fehlt.`,
      `Eine passende Karte mit „${missing[0]!.label}“ verbinden.`,
    );
  }
  const result = spec.evaluate(input, state);
  // Nur angeschlossene Eingänge dürfen den Zustand verschlechtern; ein
  // offener optionaler Eingang gräut ein gerechnetes Ergebnis nicht aus.
  const connected = spec.inputs.some((port) => input.ports[port.id]);
  if (!connected) return result;
  const incoming = inputSignal(spec as unknown as UnitSpec<unknown, never>, input);
  return { ...result, status: worstStatus([result.status, incoming.status]) };
}

/**
 * Bereitet eine Wirkung vor. Sie wird nur beschrieben — die Ausführung
 * verlangt immer eine ausdrückliche menschliche Freigabe.
 */
export function stageEffect<TOutput, TState>(
  spec: UnitSpec<TOutput, TState>,
  result: UnitResult<TOutput>,
  state: TState,
): EffectProposal | null {
  if (!spec.prepareEffect) return null;
  return spec.prepareEffect(result, state);
}

/** Text für die Freigabe-Schaltfläche: sagt klar, was gleich geschieht. */
export function effectCaution(proposal: EffectProposal): string {
  if (proposal.irreversible) return "Nicht umkehrbar — nach der Freigabe nicht zurückholbar.";
  if (proposal.status === "violation")
    return "Regelverstoß in der Grundlage — Freigabe nur mit Begründung.";
  if (proposal.status === "warn") return "Grundlage hat Lücken — vor der Freigabe gegenprüfen.";
  return "Grundlage geprüft.";
}
