/**
 * Kalibrierung: wie gut deckt sich das Urteil mit dem, was Menschen danach
 * tatsächlich getan haben.
 *
 * Grundlage sind Paare aus dem Entscheidungs-Journal: ein Urteil mit seiner
 * Sicherheit und der Ausgang, den ein Mensch im Ablagefach gesetzt hat
 * (freigegeben oder verworfen). Es wird nichts trainiert und nichts
 * vollstreckt — es wird nachgerechnet.
 *
 * Was als „bestätigt“ zählt, legt der Mensch auf der Karte fest:
 *  - "release": die Wirkung wurde freigegeben.
 *  - "followed": der Mensch ist dem Urteil gefolgt (Ja → freigegeben,
 *    Nein → verworfen). Urteile ohne Richtung zählen nicht mit.
 *
 * Invarianten:
 *  - Ohne Ausgang gibt es keine Aussage. Fehlende Rückmeldung ist „unbekannt“,
 *    nie „bestätigt“.
 *  - Unter MIN_SAMPLES bleibt die Anzeige grau: zu wenige Einsätze.
 *  - Die Sicherheit wird nie erfunden: gemessen vor selbst gesetzt vor
 *    abgeleitet — und die Herkunft wird im Klartext genannt.
 */
import type { SignalStatus } from "@/lib/runtime/signal-engine";

/** Ab so vielen bewerteten Ausgängen wird eine Aussage gemacht. */
export const MIN_SAMPLES = 3;

export type JournalOutcome = "released" | "discarded" | null;

/** Was der Mensch als Bestätigung gelten lässt. */
export type CalibrationBasis = "release" | "followed";

export interface JournalPoint {
  /** Sicherheit des Urteils, 0…1. */
  confidence: number | null;
  /** Vom Menschen selbst eingetragene Sicherheit, 0…1. */
  humanConfidence?: number | null;
  /** Wahrscheinlichkeit des Urteils, 0…1 (Ja/Nein-Fragen). */
  probability?: number | null;
  /** Richtung des Urteils: Ja, Nein — oder null ohne Richtung. */
  yes?: boolean | null;
  outcome: JournalOutcome;
}

export interface Calibration {
  /** Urteile insgesamt. */
  runs: number;
  /** Urteile, zu denen ein Mensch einen Ausgang gesetzt hat. */
  decided: number;
  /** Davon bestätigt — im Sinne der gewählten Grundlage. */
  released: number;
  /** Anteil der Bestätigungen, 0…1 — null ohne Ausgang. */
  confirmation: number | null;
  /** Mittlere Sicherheit der bewerteten Urteile, 0…1. */
  expected: number | null;
  /** Abstand zwischen Sicherheit und Praxis, 0…1. */
  gap: number | null;
  status: SignalStatus;
  /** Eine Zeile für die Karte. */
  line: string;
  /** Klartext, warum die Ampel so steht. */
  note: string;
  /** Woher die Sicherheit stammt, für die Ehrlichkeit der Zahl. */
  certaintySource: "measured" | "human" | "derived" | "none";
  basis: CalibrationBasis;
}

/** Richtung eines Urteils, falls erkennbar. */
export function verdictYes(point: JournalPoint): boolean | null {
  if (typeof point.yes === "boolean") return point.yes;
  if (typeof point.probability === "number" && Number.isFinite(point.probability)) {
    return point.probability >= 0.5;
  }
  return null;
}

/** Sicherheit eines Urteils: gemessen, sonst selbst gesetzt, sonst abgeleitet. */
export function certaintyOf(point: JournalPoint): number | null {
  if (typeof point.confidence === "number" && Number.isFinite(point.confidence)) {
    return Math.min(1, Math.max(0, point.confidence));
  }
  if (typeof point.humanConfidence === "number" && Number.isFinite(point.humanConfidence)) {
    return Math.min(1, Math.max(0, point.humanConfidence));
  }
  if (typeof point.probability === "number" && Number.isFinite(point.probability)) {
    return Math.min(1, Math.max(0, Math.abs(point.probability - 0.5) * 2));
  }
  return null;
}

function sourceOf(points: JournalPoint[]): Calibration["certaintySource"] {
  if (points.some((point) => typeof point.confidence === "number")) return "measured";
  if (points.some((point) => typeof point.humanConfidence === "number")) return "human";
  if (points.some((point) => typeof point.probability === "number")) return "derived";
  return "none";
}

function percent(value: number): number {
  return Math.round(value * 100);
}

const SOURCE_NOTE: Record<Calibration["certaintySource"], string> = {
  measured: "Sicherheit stammt aus dem Urteil.",
  human: "Sicherheit wurde von Hand eingetragen.",
  derived: "Sicherheit ist nur abgeleitet — das Urteil liefert keine. Bitte auf der Karte eintragen.",
  none: "Keine Sicherheit hinterlegt.",
};

export function calibrate(
  points: JournalPoint[],
  options: { basis?: CalibrationBasis } = {},
): Calibration {
  const basis = options.basis ?? "release";
  const runs = points.length;

  // Bei „gefolgt“ zählen nur Urteile mit erkennbarer Richtung.
  const usable =
    basis === "followed" ? points.filter((point) => verdictYes(point) !== null) : points;
  const decided = usable.filter((point) => point.outcome !== null);
  const confirmedCount = decided.filter((point) =>
    basis === "followed"
      ? (verdictYes(point) === true && point.outcome === "released") ||
        (verdictYes(point) === false && point.outcome === "discarded")
      : point.outcome === "released",
  ).length;

  const rated = decided
    .map((point) => certaintyOf(point))
    .filter((value): value is number => value !== null);

  const confirmation = decided.length ? confirmedCount / decided.length : null;
  const expected = rated.length ? rated.reduce((sum, value) => sum + value, 0) / rated.length : null;
  const gap = confirmation !== null && expected !== null ? Math.abs(expected - confirmation) : null;
  const certaintySource = sourceOf(decided);
  const word = basis === "followed" ? "gefolgt" : "Bestätigung";

  const base = { runs, decided: decided.length, released: confirmedCount, confirmation, expected, gap, certaintySource, basis };

  if (runs === 0) {
    return {
      ...base,
      status: "idle",
      line: "Noch kein Urteil im Journal",
      note: "Sobald diese Karte entscheidet, wird jedes Urteil unveränderlich festgehalten.",
    };
  }

  if (decided.length < MIN_SAMPLES) {
    return {
      ...base,
      status: "idle",
      line: `${runs} Urteile · ${decided.length} mit Rückmeldung`,
      note: `Erst ab ${MIN_SAMPLES} freigegebenen oder verworfenen Wirkungen lässt sich etwas ablesen.`,
    };
  }

  const status: SignalStatus =
    gap === null ? "idle" : gap <= 0.1 ? "ok" : gap <= 0.25 ? "warn" : "violation";
  const line = `${decided.length} Einsätze · ${percent(confirmation ?? 0)} % ${word}`;
  const verdictNote =
    status === "ok"
      ? `Urteil und Praxis decken sich: ${percent(expected ?? 0)} % Sicherheit, ${percent(confirmation ?? 0)} % ${word}.`
      : `Urteil und Praxis gehen auseinander: ${percent(expected ?? 0)} % Sicherheit, aber nur ${percent(confirmation ?? 0)} % ${word} (${percent(gap ?? 0)} Punkte Abstand).`;

  return { ...base, status, line, note: `${verdictNote} ${SOURCE_NOTE[certaintySource]}` };
}
