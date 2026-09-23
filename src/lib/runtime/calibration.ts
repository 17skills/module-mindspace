/**
 * Kalibrierung: wie gut deckt sich das Urteil mit dem, was Menschen danach
 * tatsächlich getan haben.
 *
 * Grundlage sind Paare aus dem Entscheidungs-Journal: ein Urteil mit seiner
 * Sicherheit und der Ausgang, den ein Mensch im Ablagefach gesetzt hat
 * (freigegeben oder verworfen). Es wird nichts trainiert und nichts
 * vollstreckt — es wird nachgerechnet.
 *
 * Invarianten:
 *  - Ohne Ausgang gibt es keine Aussage. Fehlende Rückmeldung ist „unbekannt“,
 *    nie „bestätigt“.
 *  - Unter MIN_SAMPLES bleibt die Anzeige grau: zu wenige Einsätze.
 *  - Die Sicherheit wird nie erfunden: fehlt sie, wird sie aus der
 *    Wahrscheinlichkeit abgeleitet (Abstand zur Unentschiedenheit) oder das
 *    Paar zählt nur als Einsatz, nicht als Messpunkt.
 */
import type { SignalStatus } from "@/lib/runtime/signal-engine";

/** Ab so vielen bewerteten Ausgängen wird eine Aussage gemacht. */
export const MIN_SAMPLES = 3;

export type JournalOutcome = "released" | "discarded" | null;

export interface JournalPoint {
  /** Sicherheit des Urteils, 0…1. */
  confidence: number | null;
  /** Wahrscheinlichkeit des Urteils, 0…1 (Ja/Nein-Fragen). */
  probability?: number | null;
  outcome: JournalOutcome;
}

export interface Calibration {
  /** Urteile insgesamt. */
  runs: number;
  /** Urteile, zu denen ein Mensch einen Ausgang gesetzt hat. */
  decided: number;
  /** Davon freigegeben. */
  released: number;
  /** Anteil der Freigaben, 0…1 — null ohne Ausgang. */
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
}

/** Sicherheit eines Urteils: gemessen, sonst aus der Wahrscheinlichkeit. */
export function certaintyOf(point: JournalPoint): number | null {
  if (typeof point.confidence === "number" && Number.isFinite(point.confidence)) {
    return Math.min(1, Math.max(0, point.confidence));
  }
  if (typeof point.probability === "number" && Number.isFinite(point.probability)) {
    return Math.min(1, Math.max(0, Math.abs(point.probability - 0.5) * 2));
  }
  return null;
}

function percent(value: number): number {
  return Math.round(value * 100);
}

export function calibrate(points: JournalPoint[]): Calibration {
  const runs = points.length;
  const decided = points.filter((point) => point.outcome !== null);
  const released = decided.filter((point) => point.outcome === "released").length;
  const rated = decided
    .map((point) => certaintyOf(point))
    .filter((value): value is number => value !== null);

  const confirmation = decided.length ? released / decided.length : null;
  const expected = rated.length ? rated.reduce((sum, value) => sum + value, 0) / rated.length : null;
  const gap = confirmation !== null && expected !== null ? Math.abs(expected - confirmation) : null;

  if (runs === 0) {
    return {
      runs: 0,
      decided: 0,
      released: 0,
      confirmation: null,
      expected: null,
      gap: null,
      status: "idle",
      line: "Noch kein Urteil im Journal",
      note: "Sobald diese Karte entscheidet, wird jedes Urteil unveränderlich festgehalten.",
    };
  }

  if (decided.length < MIN_SAMPLES) {
    return {
      runs,
      decided: decided.length,
      released,
      confirmation,
      expected,
      gap,
      status: "idle",
      line: `${runs} Urteile · ${decided.length} mit Rückmeldung`,
      note: `Erst ab ${MIN_SAMPLES} freigegebenen oder verworfenen Wirkungen lässt sich etwas ablesen.`,
    };
  }

  const status: SignalStatus = gap === null ? "idle" : gap <= 0.1 ? "ok" : gap <= 0.25 ? "warn" : "violation";
  const line = `${decided.length} Einsätze · ${percent(confirmation ?? 0)} % Bestätigung`;
  const note =
    status === "ok"
      ? `Urteil und Praxis decken sich: ${percent(expected ?? 0)} % Sicherheit, ${percent(confirmation ?? 0)} % Freigaben.`
      : `Urteil und Praxis gehen auseinander: ${percent(expected ?? 0)} % Sicherheit, aber nur ${percent(confirmation ?? 0)} % Freigaben (${percent(gap ?? 0)} Punkte Abstand).`;

  return { runs, decided: decided.length, released, confirmation, expected, gap, status, line, note };
}
