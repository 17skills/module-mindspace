/**
 * Ablagefach für Wirkungen (Staging Area).
 *
 * scopebuilder ist Signalgeber, nicht Vollstrecker. Ein Aktions-Modul
 * bereitet eine Wirkung nach außen ausschließlich VOR: es beschreibt sie
 * vollständig, friert die Nutzlast ein und legt sie ins Ablagefach.
 * Erst ein Mensch gibt frei — und die Freigabe wird protokolliert.
 *
 * Invarianten:
 *  - Nichts verlässt das Ablagefach von selbst; kein Timer, kein Agent.
 *  - Jede Wirkung trägt ihre Grundlage und deren Zustand (Ampel) mit sich.
 *  - Freigabe bei Lücken oder Regelverstoß ist möglich, aber nie stillschweigend.
 */
import type { SignalStatus } from "@/lib/runtime/signal-engine";
import { worstStatus } from "@/lib/runtime/signal-engine";
import {
  effectCaution,
  type EffectProposal,
  type UnitResult,
  type UnitSpec,
} from "@/lib/runtime/unit-spec";

export type StagedState = "staged" | "released" | "discarded";

export interface ActionChannelSpec {
  id: string;
  label: string;
  /** Wirkung nach außen, die nicht zurückgeholt werden kann. */
  irreversible: boolean;
  /** Wofür das Feld „Empfänger“ steht. */
  recipientLabel: string;
}

export const ACTION_CHANNELS: ActionChannelSpec[] = [
  { id: "email", label: "E-Mail", irreversible: true, recipientLabel: "Empfänger" },
  { id: "task", label: "Aufgabe", irreversible: false, recipientLabel: "Zuständig" },
  { id: "report", label: "Meldung", irreversible: false, recipientLabel: "Stelle" },
  { id: "interface", label: "Schnittstelle", irreversible: true, recipientLabel: "Ziel" },
];

export function channelSpec(id: string): ActionChannelSpec {
  return ACTION_CHANNELS.find((item) => item.id === id) ?? ACTION_CHANNELS[1]!;
}

/** Eine Karte, die dieses Aktions-Modul speist: Titel, Klartext, Zustand. */
export interface ActionBasis {
  unitId: string;
  title: string;
  brief: string;
  status: SignalStatus;
  /**
   * Urteile im Entscheidungs-Journal, aus denen diese Grundlage stammt.
   * Freigabe oder Verwerfung wird genau auf diese Urteile zurückgeschrieben.
   */
  journalIds?: string[];
}

export interface ActionConfig {
  channel: string;
  /** Was geschähe, in einem Satz. */
  summary: string;
  recipient: string;
  /** Zusatz des Menschen zur Nutzlast. */
  message: string;
}

export interface ActionState {
  config: ActionConfig;
  basis: ActionBasis[];
}

export interface ActionDraft {
  channel: string;
  recipient: string;
  message: string;
  /** Eingefrorene Grundlage: was zum Zeitpunkt des Vorschlags galt. */
  basis: ActionBasis[];
}

/** Vorschlag im Ablagefach, inklusive menschlicher Entscheidung. */
export interface StagedEffect extends EffectProposal {
  state: StagedState;
  /** Warnhinweis, der bei der Freigabe sichtbar war. */
  caution: string;
  decidedAt?: string;
  decidedBy?: string;
  /** Begründung des Menschen — Pflicht bei Regelverstoß. */
  note?: string;
}

export const EMPTY_CONFIG: ActionConfig = {
  channel: "task",
  summary: "",
  recipient: "",
  message: "",
};

/** Zustand der Grundlage: der schlechteste Eingang bestimmt die Ampel. */
export function basisStatus(basis: ActionBasis[]): SignalStatus {
  if (!basis.length) return "idle";
  return worstStatus(basis.map((item) => item.status));
}

function rationaleOf(state: ActionState): string {
  if (!state.basis.length) return "Keine Grundlage verbunden.";
  return state.basis
    .map((item) => `${item.title}: ${item.brief.split("\n")[0]?.slice(0, 160) ?? "ohne Inhalt"}`)
    .join(" · ");
}

/**
 * Der Modul-Vertrag eines Aktions-Moduls. Es rechnet sofort (was wäre die
 * Wirkung?) und kann sie beschreiben — ausführen kann es nichts.
 */
export function actionUnit(): UnitSpec<ActionDraft, ActionState> {
  return {
    kind: "action",
    type: "action.staging",
    label: "Aktion",
    inputs: [{ id: "basis", label: "Grundlage", accepts: ["dataset", "entity", "document", "evidence"] }],
    emits: null,
    evaluate: (_input, state) => {
      const status = basisStatus(state.basis);
      const missing: string[] = [];
      if (!state.config.summary.trim()) missing.push("Beschreibung der Wirkung");
      if (!state.config.recipient.trim()) missing.push(channelSpec(state.config.channel).recipientLabel);
      if (!state.basis.length) missing.push("verbundene Grundlage");

      if (missing.length) {
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
            explanation: {
              headline: "Wirkung noch nicht beschreibbar",
              cause: `Es fehlt: ${missing.join(", ")}.`,
              remedy: "Felder ausfüllen und eine Karte als Grundlage verbinden.",
            },
          },
          notes: missing,
        };
      }

      return {
        status,
        output: {
          channel: state.config.channel,
          recipient: state.config.recipient.trim(),
          message: state.config.message.trim(),
          basis: state.basis,
        },
        signal: {
          status,
          display: state.config.summary.trim(),
          confidence: 1,
          completeness: 1,
          findings: [],
          facet: null,
          explanation: {
            headline: "Wirkung ist vorbereitbar",
            cause: rationaleOf(state),
            remedy: "Vorschlag ins Ablagefach legen — Ausführung erst nach Freigabe.",
          },
        },
        notes: [],
      };
    },
    prepareEffect: (result, state) => {
      if (!result.output) return null;
      const spec = channelSpec(state.config.channel);
      return {
        id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
        unitId: state.config.channel,
        summary: state.config.summary.trim(),
        channel: spec.label,
        payload: {
          recipient: result.output.recipient,
          message: result.output.message,
          basis: result.output.basis.map((item) => ({ title: item.title, brief: item.brief })),
        },
        rationale: rationaleOf(state),
        status: result.status,
        irreversible: spec.irreversible,
        preparedAt: new Date().toISOString(),
      };
    },
  };
}

/** Legt einen Vorschlag ins Ablagefach — immer im Zustand „wartet auf Freigabe“. */
export function toStaged(proposal: EffectProposal): StagedEffect {
  return { ...proposal, state: "staged", caution: effectCaution(proposal) };
}

/** Pflicht zur Begründung: bei Regelverstoß oder unumkehrbarer Wirkung. */
export function needsJustification(effect: StagedEffect): boolean {
  return effect.status === "violation" || effect.irreversible;
}

export function releaseEffect(effect: StagedEffect, by: string, note: string): StagedEffect {
  return {
    ...effect,
    state: "released",
    decidedAt: new Date().toISOString(),
    decidedBy: by,
    note: note.trim(),
  };
}

export function discardEffect(effect: StagedEffect, by: string, note = ""): StagedEffect {
  return {
    ...effect,
    state: "discarded",
    decidedAt: new Date().toISOString(),
    decidedBy: by,
    note: note.trim(),
  };
}

/** Im Knoten gespeicherter Stand des Ablagefachs. */
export interface StoredAction {
  config: ActionConfig;
  effects: StagedEffect[];
}

export function readAction(
  metadata: Record<string, unknown> | null | undefined,
): StoredAction {
  const raw = (metadata as { action?: Partial<StoredAction> } | null | undefined)?.action;
  return {
    config: { ...EMPTY_CONFIG, ...(raw?.config ?? {}) },
    effects: Array.isArray(raw?.effects) ? (raw.effects as StagedEffect[]) : [],
  };
}

/** Klartext-Protokoll des Ablagefachs, z. B. für Chat und Freigabe-Prüfung. */
export function stagingBrief(stored: StoredAction): string {
  if (!stored.effects.length) return "";
  const lines = stored.effects.map((effect) => {
    const state =
      effect.state === "released"
        ? `freigegeben von ${effect.decidedBy ?? "unbekannt"}`
        : effect.state === "discarded"
          ? "verworfen"
          : "wartet auf Freigabe";
    return `- ${effect.channel}: ${effect.summary} — ${state}${effect.note ? ` (${effect.note})` : ""}`;
  });
  return [`## Ablagefach`, ...lines].join("\n");
}

/** Ergebnis-Text für die Karte: was das Modul gerade sagen würde. */
export function draftLine(result: UnitResult<ActionDraft>): string {
  return result.signal.explanation.headline;
}
