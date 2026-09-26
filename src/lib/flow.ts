/**
 * Allgemeiner Ablauf „Quelle → Schritt → Ergebnis“ ohne Sondercode je Anwendungsfall.
 * Reine Funktionen: Werte einsetzen und Punkte aus einer JSON-Antwort lesen.
 */

export type FlowInput = Record<string, string | number>;

const INPUT_TOKEN = /\{\{\s*input\.([a-zA-Z0-9_]+)\s*\}\}/g;

/** Nur Zahlen oder kurze, harmlose Texte dürfen in Anfragen landen. */
export function cleanInput(raw: Record<string, unknown>): FlowInput {
  const out: FlowInput = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!/^[a-zA-Z0-9_]{1,32}$/.test(key)) continue;
    if (typeof value === "number" && Number.isFinite(value)) out[key] = value;
    else if (typeof value === "string") {
      const text = value.replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 200);
      if (text) out[key] = text;
    }
  }
  return out;
}

export function hasInputTokens(text: string): boolean {
  return new RegExp(INPUT_TOKEN.source).test(text);
}

/**
 * Setzt {{input.x}} ein. In Adressen werden Werte URL-kodiert, damit eine Eingabe
 * nie Host, Pfad oder weitere Parameter verändern kann.
 */
export function fillInputs(text: string, input: FlowInput, mode: "url" | "raw" = "raw"): string {
  return text.replace(INPUT_TOKEN, (_match, key: string) => {
    const value = input[key];
    if (value === undefined) {
      throw new Error(`Dieser Schritt braucht den Wert „${key}“ aus der vorgeschalteten Quelle`);
    }
    const plain = String(value);
    return mode === "url" ? encodeURIComponent(plain) : plain.replace(/["\\]/g, "");
  });
}

export type PointSpec = {
  /** Pfad zur Liste in der Antwort, z. B. "elements". */
  list: string;
  /** Pfade je Feld; Alternativen mit "|", z. B. "lat|center.lat". */
  lat: string;
  lon: string;
  label: string;
  note: string;
};

export type FlowPoint = { id: string; label: string; lat: number; lon: number; note: string; distance: number | null };

export function readPointSpec(raw: unknown): PointSpec | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const s = (key: string, fallback: string) => (typeof row[key] === "string" ? (row[key] as string) : fallback);
  return { list: s("list", ""), lat: s("lat", "lat"), lon: s("lon", "lon"), label: s("label", "name"), note: s("note", "") };
}

function walk(data: unknown, path: string): unknown {
  let current: unknown = data;
  for (const step of path.split(".").map((p) => p.trim()).filter(Boolean)) {
    if (current == null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[step];
  }
  return current;
}

function first(data: unknown, paths: string): unknown {
  for (const path of paths.split("|")) {
    const value = walk(data, path);
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return undefined;
}

export function distanceMeters(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return Math.round(2 * 6_371_000 * Math.asin(Math.sqrt(h)));
}

/** Liest Punkte defensiv; Einträge ohne Namen oder Koordinaten fallen weg. */
export function readPoints(
  body: string | null | undefined,
  spec: PointSpec,
  origin?: { lat: number; lon: number } | null,
  limit = 30,
): FlowPoint[] {
  if (!body) return [];
  let data: unknown;
  try {
    data = JSON.parse(body);
  } catch {
    return [];
  }
  const list = spec.list ? walk(data, spec.list) : data;
  if (!Array.isArray(list)) return [];
  const points: FlowPoint[] = [];
  list.forEach((item, index) => {
    const lat = Number(first(item, spec.lat));
    const lon = Number(first(item, spec.lon));
    const label = first(item, spec.label);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || typeof label !== "string" || !label.trim()) return;
    const note = spec.note ? first(item, spec.note) : undefined;
    points.push({
      id: `p${index}`,
      label: label.slice(0, 120),
      lat,
      lon,
      note: typeof note === "string" ? note.replace(/;/g, ", ").slice(0, 80) : "",
      distance: origin ? distanceMeters(origin, { lat, lon }) : null,
    });
  });
  if (origin) points.sort((a, b) => (a.distance ?? 0) - (b.distance ?? 0));
  return points.slice(0, limit);
}

/** Ergebnis als lesbarer Bericht für das Ergebnis-Modul. */
export function pointsReport(title: string, points: FlowPoint[]): string {
  if (!points.length) return `${title}: nichts gefunden.`;
  return [
    `**${title}** (${points.length})`,
    "",
    ...points.map(
      (p) => `- ${p.label}${p.note ? ` – ${p.note}` : ""}${p.distance !== null ? ` · ${p.distance} m` : ""}`,
    ),
  ].join("\n");
}
