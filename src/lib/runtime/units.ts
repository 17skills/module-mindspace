/**
 * Die echten Karten als Modul-Verträge.
 *
 * Quelle, Risiko und Entscheidung sind ab hier keine Sonderfälle mehr,
 * sondern erfüllen denselben Vertrag wie jedes andere Modul: typisierte
 * Eingänge, sofortige reine Bewertung, Ampel mit Klartext. Der spätere
 * Bake-Compiler liest ausschließlich diese Verträge — er muss nichts raten.
 *
 * Invarianten:
 *  - Kein Vertrag führt etwas aus; Wirkung nach außen gibt es nur über das Ablagefach.
 *  - Fehlt etwas, kommt ein erklärtes Wartezeichen, nie ein Absturz.
 *  - Lücken werden benannt, nie stillschweigend verworfen.
 */
import type { RiskField, IsoResult } from "@/lib/iso-risk";
import { classOf, evaluate as evaluateIso } from "@/lib/iso-risk";
import type { Ontology } from "@/lib/runtime/rule-ontology";
import { evaluateSignal, type Signal, type SignalStatus } from "@/lib/runtime/signal-engine";
import type { SourceEnvelope } from "@/lib/runtime/source-protocol";
import { describeEnvelope } from "@/lib/runtime/source-protocol";
import { actionUnit } from "@/lib/runtime/staging";
import type { UnitResult, UnitSpec } from "@/lib/runtime/unit-spec";

function wrap(status: SignalStatus, signal: Signal, notes: string[] = []): Omit<
  UnitResult<never>,
  "output"
> {
  return { status, signal, notes };
}

function makeSignal(
  status: SignalStatus,
  display: string,
  headline: string,
  cause: string,
  remedy: string,
): Signal {
  return {
    status,
    display,
    confidence: status === "idle" ? 0 : 1,
    completeness: status === "idle" ? 0 : 1,
    findings: [],
    facet: null,
    explanation: { headline, cause, remedy },
  };
}

/* ------------------------------------------------------------------ Quelle */

export interface SourceUnitState {
  envelope: SourceEnvelope | null;
  /** Regelwerk eines verbundenen Moduls — optional, nie Pflicht. */
  ontology: Ontology | null;
}

/** Die Quellen-Karte: nimmt auf, bewertet Qualität und Regeln, gibt weiter. */
export function sourceUnit(): UnitSpec<SourceEnvelope, SourceUnitState> {
  return {
    kind: "source",
    type: "source.envelope",
    label: "Quelle",
    inputs: [],
    emits: "any",
    evaluate: (_input, state) => {
      const signal = evaluateSignal({
        envelope: state.envelope,
        ontology: state.ontology,
      });
      if (!state.envelope) {
        return { status: "idle", output: null, signal, notes: ["Noch keine Quelle abgelegt."] };
      }
      return {
        ...wrap(signal.status, signal, [describeEnvelope(state.envelope)]),
        output: state.envelope,
      };
    },
  };
}

/* ------------------------------------------------------------------ Risiko */

export interface RiskUnitState {
  /** Eigene Zeilen plus die aus verbundenen Quellen. */
  fields: RiskField[];
  /** Zeilen aus Quellen, denen etwas fehlt — im Klartext. */
  gaps: string[];
}

/** Die Risiko-Karte nach ISO 55001: S = E × A, Lücken bleiben sichtbar. */
export function riskUnit(): UnitSpec<IsoResult, RiskUnitState> {
  return {
    kind: "logic",
    type: "risk.iso55001",
    label: "Risiko",
    inputs: [{ id: "data", label: "Datengrundlage", accepts: ["dataset", "entity", "document"] }],
    emits: "dataset",
    evaluate: (_input, state) => {
      if (!state.fields.length) {
        return {
          status: "idle",
          output: null,
          signal: makeSignal(
            "idle",
            "—",
            "Noch nichts zu bewerten",
            "Keine Zeile mit Eintritt und Auswirkung vorhanden.",
            "Zeile ergänzen oder eine Datenquelle verbinden.",
          ),
          notes: [],
        };
      }
      const result = evaluateIso(state.fields);
      const klass = classOf(result.highest);
      const status: SignalStatus =
        result.highest >= 20 ? "violation" : state.gaps.length || result.highest >= 12 ? "warn" : "ok";
      return {
        status,
        output: result,
        signal: makeSignal(
          status,
          `${result.highest} · ${klass.key}`,
          `Höchster Score ${result.highest} — Klasse ${klass.label}`,
          state.gaps.length
            ? `${state.gaps.length} Zeile(n) unvollständig: ${state.gaps.slice(0, 3).join(" · ")}`
            : `${result.fields.length} Zeile(n) bewertet, Portfolio-Index ${result.index} / 100.`,
          klass.action,
        ),
        notes: state.gaps,
      };
    },
  };
}

/* ------------------------------------------------------- Entscheidung (JEV) */

export interface DecisionUnitState {
  questions: number;
  answered: number;
  /** Prüfungen unter der geforderten Sicherheit. */
  review: number;
  /** Mittlere Sicherheit in Prozent, null wenn nichts bewertet wurde. */
  confidence: number | null;
}

export interface DecisionVerdict {
  answered: number;
  questions: number;
  review: number;
  confidence: number | null;
}

/** Die Entscheidungs-Karte: urteilt, beschließt aber nicht. */
export function decisionUnit(): UnitSpec<DecisionVerdict, DecisionUnitState> {
  return {
    kind: "logic",
    type: "decision.jev",
    label: "Entscheidung",
    inputs: [
      { id: "context", label: "Grundlage", accepts: ["dataset", "entity", "document", "evidence"] },
    ],
    emits: "document",
    evaluate: (_input, state) => {
      const output: DecisionVerdict = {
        answered: state.answered,
        questions: state.questions,
        review: state.review,
        confidence: state.confidence,
      };
      if (!state.questions || !state.answered) {
        return {
          status: "idle",
          output: null,
          signal: makeSignal(
            "idle",
            "—",
            "Noch nicht bewertet",
            state.questions ? "Keine Frage beantwortet." : "Keine Frage gestellt.",
            "Grundlage verbinden und Bewertung anstoßen.",
          ),
          notes: [],
        };
      }
      const status: SignalStatus = state.review ? "warn" : "ok";
      return {
        status,
        output,
        signal: makeSignal(
          status,
          state.confidence == null ? "—" : `${state.confidence} %`,
          state.review ? `${state.review} Prüfung(en) offen` : "Entscheidung belastbar",
          `${state.answered} von ${state.questions} Fragen beantwortet.`,
          state.review
            ? "Offene Prüfungen gegenlesen, bevor etwas freigegeben wird."
            : "Grundlage geprüft — Freigabe bleibt beim Menschen.",
        ),
        notes: [],
      };
    },
  };
}

/* ---------------------------------------------------------------- Register */

/** Karten-Typ auf Canvas → Modul-Vertrag. Der Compiler liest nur hierüber. */
export const UNIT_REGISTRY: Record<string, () => UnitSpec<unknown, never>> = {
  source: sourceUnit as unknown as () => UnitSpec<unknown, never>,
  risk: riskUnit as unknown as () => UnitSpec<unknown, never>,
  decision: decisionUnit as unknown as () => UnitSpec<unknown, never>,
  action: actionUnit as unknown as () => UnitSpec<unknown, never>,
};

/** Vertrag zu einem Kartentyp, oder null wenn die Karte (noch) keinen hat. */
export function unitForType(type: string): UnitSpec<unknown, never> | null {
  const factory = UNIT_REGISTRY[type];
  return factory ? factory() : null;
}
