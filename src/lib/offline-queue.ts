/**
 * Warteschlange für die mobile Erfassung: Befunde, die ohne Netz entstehen,
 * bleiben im Browser liegen und werden später hochgeladen.
 */

export type QueuedFinding = {
  id: string;
  appId: string;
  createdAt: string;
  label: string;
  report: string;
  lat: number | null;
  lon: number | null;
  source: "exif" | "manuell" | "unbekannt";
  photo: string;
  /** Kleines Vorschaubild, das im Scope direkt angezeigt wird. */
  thumb?: string | null;
  /** Bereits bewertet? Dann steht hier das Ergebnis der KI-Bewertung. */
  assessment: {
    label: string;
    category: string;
    finding: string;
    priority: number;
    action: string;
    cost: number;
    confidence: number;
    reason: string;
  } | null;
};

const KEY = "scopebuilder.offlineFindings";

function read(): QueuedFinding[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    const list = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(list) ? (list as QueuedFinding[]) : [];
  } catch {
    return [];
  }
}

function write(list: QueuedFinding[]) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* Speicher voll – der Befund bleibt dann nur im Formular */
  }
}

export function queuedFor(appId: string): QueuedFinding[] {
  return read().filter((entry) => entry.appId === appId);
}

export function enqueueFinding(entry: Omit<QueuedFinding, "id" | "createdAt">): QueuedFinding {
  const full: QueuedFinding = {
    ...entry,
    id: `queued-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    createdAt: new Date().toISOString(),
  };
  write([...read(), full]);
  return full;
}

export function dequeueFinding(id: string) {
  write(read().filter((entry) => entry.id !== id));
}
