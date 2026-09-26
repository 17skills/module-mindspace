import type { NodeRecord } from "@/components/canvas/board-context";
import { readStructure } from "@/lib/structure";
import { priorityColor, readInspection } from "@/lib/inspection";
import { readPointSpec, readPoints } from "@/lib/flow";

export type GeoPoint = {
  id: string;
  label: string;
  lat: number;
  lon: number;
  /** Class or type of the object, e.g. a building class. */
  klass: string;
  /** Impact / importance 1..5 when supplied by the data. */
  impact: number | null;
  /** Optional pin colour override (e.g. inspection priority colour). */
  color?: string | null;
  /** Optional photo (data URL) shown on hover / selection. */
  photo?: string | null;
  /** Optional short report text shown on hover / selection. */
  note?: string | null;
};

export type WeatherValue = {
  rain: number | null;
  wind: number | null;
  temp: number | null;
};

export type MapConfig = {
  columns: { label: string; lat: string; lon: string; klass: string; impact: string };
  weather: Record<string, WeatherValue>;
  lastAt: string | null;
  center: [number, number];
  zoom: number;
};

export type RiskConfig = {
  rainWarn: number;
  rainDanger: number;
  windWarn: number;
  windDanger: number;
  /** Fallback impact per class name, 1..5. */
  impactMap: Record<string, number>;
  defaultImpact: number;
};

function num(raw: unknown, fallback: number): number {
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

function str(raw: unknown, fallback = ""): string {
  return typeof raw === "string" && raw ? raw : fallback;
}

export function readMapConfig(record: NodeRecord | null | undefined): MapConfig {
  const meta = (record?.metadata ?? {}) as Record<string, unknown>;
  const columns = (meta["columns"] ?? {}) as Record<string, unknown>;
  const rawWeather = (meta["weather"] ?? {}) as Record<string, unknown>;
  const weather: Record<string, WeatherValue> = {};
  for (const [key, value] of Object.entries(rawWeather)) {
    const row = (value ?? {}) as Record<string, unknown>;
    weather[key] = {
      rain: Number.isFinite(Number(row["rain"])) ? Number(row["rain"]) : null,
      wind: Number.isFinite(Number(row["wind"])) ? Number(row["wind"]) : null,
      temp: Number.isFinite(Number(row["temp"])) ? Number(row["temp"]) : null,
    };
  }
  const rawCenter = meta["center"];
  const center: [number, number] = Array.isArray(rawCenter)
    ? [num(rawCenter[0], 51.1), num(rawCenter[1], 10.4)]
    : [51.1, 10.4];
  return {
    columns: {
      label: str(columns["label"]),
      lat: str(columns["lat"]),
      lon: str(columns["lon"]),
      klass: str(columns["klass"]),
      impact: str(columns["impact"]),
    },
    weather,
    lastAt: typeof meta["lastAt"] === "string" ? meta["lastAt"] : null,
    center,
    zoom: num(meta["zoom"], 5),
  };
}

export function readRiskConfig(record: NodeRecord | null | undefined): RiskConfig {
  const meta = (record?.metadata ?? {}) as Record<string, unknown>;
  const rawMap = (meta["impactMap"] ?? {}) as Record<string, unknown>;
  const impactMap: Record<string, number> = {};
  for (const [key, value] of Object.entries(rawMap)) {
    const level = Number(value);
    if (Number.isFinite(level)) impactMap[key] = Math.min(5, Math.max(1, Math.round(level)));
  }
  return {
    rainWarn: num(meta["rainWarn"], 5),
    rainDanger: num(meta["rainDanger"], 25),
    windWarn: num(meta["windWarn"], 40),
    windDanger: num(meta["windDanger"], 75),
    impactMap,
    defaultImpact: Math.min(5, Math.max(1, num(meta["defaultImpact"], 3))),
  };
}

function toNumber(raw: string | undefined): number | null {
  if (!raw) return null;
  const value = Number(String(raw).replace(",", ".").replace(/[^\d.-]/g, ""));
  return Number.isFinite(value) ? value : null;
}

const LAT_NAMES = ["lat", "latitude", "breite", "breitengrad", "y"];
const LON_NAMES = ["lon", "lng", "long", "longitude", "länge", "laenge", "längengrad", "x"];
const LABEL_NAMES = ["name", "bezeichnung", "label", "objekt", "titel", "asset", "standort"];
const KLASS_NAMES = ["klasse", "class", "typ", "type", "kategorie", "gebäudeklasse"];
const IMPACT_NAMES = ["impact", "auswirkung", "bedeutung", "kritikalität", "schaden", "wert"];

function guess(columns: string[], names: string[], chosen: string): number {
  if (chosen) {
    const exact = columns.findIndex((column) => column === chosen);
    if (exact >= 0) return exact;
  }
  return columns.findIndex((column) => names.includes(column.trim().toLowerCase()));
}

/** Reads geocoded rows from connected table modules. */
export function pointsFromSources(sources: NodeRecord[], config: MapConfig): GeoPoint[] {
  const points: GeoPoint[] = [];
  for (const source of sources) {
    // Inspection findings carry their own position out of the photo metadata.
    if (source.type === "inspect") {
      for (const finding of readInspection(source).findings) {
        if (finding.lat == null || finding.lon == null) continue;
        points.push({
          id: finding.id,
          label: `${finding.label} · Prio ${finding.priority}`,
          lat: finding.lat,
          lon: finding.lon,
          klass: finding.category,
          impact: Math.min(5, Math.max(1, Math.round((11 - finding.priority) / 2))),
          color: priorityColor(finding.priority),
          photo: finding.thumb ?? null,
          note: [finding.finding, finding.action].filter(Boolean).join(" · "),
        });
      }
      continue;
    }
    // API-Schritte mit Punkt-Zuordnung (metadata.points) liefern Orte aus ihrer letzten Antwort.
    if (source.type === "api") {
      const spec = readPointSpec((source.metadata ?? {})["points"]);
      if (!spec) continue;
      for (const point of readPoints(source.content, spec)) {
        points.push({
          id: `${source.id}:${point.id}`,
          label: point.label,
          lat: point.lat,
          lon: point.lon,
          klass: source.title ?? "",
          impact: null,
          note: point.note,
        });
      }
      continue;
    }
    if (source.type !== "table" && source.type !== "list") continue;
    const data = readStructure(source);
    if (!data.columns.length) continue;
    const latIndex = guess(data.columns, LAT_NAMES, config.columns.lat);
    const lonIndex = guess(data.columns, LON_NAMES, config.columns.lon);
    if (latIndex < 0 || lonIndex < 0) continue;
    const labelIndex = guess(data.columns, LABEL_NAMES, config.columns.label);
    const klassIndex = guess(data.columns, KLASS_NAMES, config.columns.klass);
    const impactIndex = guess(data.columns, IMPACT_NAMES, config.columns.impact);
    data.rows.forEach((row, index) => {
      const lat = toNumber(row[latIndex]);
      const lon = toNumber(row[lonIndex]);
      if (lat === null || lon === null) return;
      points.push({
        id: `${source.id}:${index}`,
        label: (labelIndex >= 0 ? row[labelIndex] : "") || `Objekt ${index + 1}`,
        lat,
        lon,
        klass: (klassIndex >= 0 ? row[klassIndex] : "") ?? "",
        impact: impactIndex >= 0 ? toNumber(row[impactIndex]) : null,
      });
    });
  }
  return points;
}

/** Likelihood level 1..5 from the current weather at a point. */
export function likelihood(weather: WeatherValue | undefined, config: RiskConfig): number {
  if (!weather) return 1;
  const rain = weather.rain ?? 0;
  const wind = weather.wind ?? 0;
  const rainLevel =
    rain >= config.rainDanger
      ? 5
      : rain >= (config.rainWarn + config.rainDanger) / 2
        ? 4
        : rain >= config.rainWarn
          ? 3
          : rain > 0
            ? 2
            : 1;
  const windLevel =
    wind >= config.windDanger
      ? 5
      : wind >= (config.windWarn + config.windDanger) / 2
        ? 4
        : wind >= config.windWarn
          ? 3
          : wind > 0
            ? 2
            : 1;
  return Math.max(rainLevel, windLevel);
}

export function impactOf(point: GeoPoint, config: RiskConfig): number {
  if (point.impact != null && Number.isFinite(point.impact)) {
    return Math.min(5, Math.max(1, Math.round(point.impact)));
  }
  const byClass = config.impactMap[point.klass.trim().toLowerCase()];
  return byClass ?? config.defaultImpact;
}

export type RiskEntry = {
  point: GeoPoint;
  likelihood: number;
  impact: number;
  /** 1..5 overall risk level. */
  level: number;
};

export function riskEntries(
  points: GeoPoint[],
  weather: Record<string, WeatherValue>,
  config: RiskConfig,
): RiskEntry[] {
  return points.map((point) => {
    const l = likelihood(weather[point.id], config);
    const i = impactOf(point, config);
    const level = Math.min(5, Math.max(1, Math.round((l * i) / 5)));
    return { point, likelihood: l, impact: i, level };
  });
}

export function maxRisk(entries: RiskEntry[]): number | null {
  if (!entries.length) return null;
  return entries.reduce((max, entry) => Math.max(max, entry.level), 0);
}

export const RISK_LABEL: Record<number, string> = {
  1: "sehr gering",
  2: "gering",
  3: "mittel",
  4: "hoch",
  5: "sehr hoch",
};

/** Colour of a risk cell, green → yellow → red. */
export function riskColor(likelihoodLevel: number, impactLevel: number): string {
  const score = likelihoodLevel * impactLevel; // 1..25
  if (score >= 16) return "#dc2626";
  if (score >= 10) return "#ea580c";
  if (score >= 6) return "#eab308";
  if (score >= 3) return "#84cc16";
  return "#16a34a";
}

/** Readable summary used as chat / decision context. */
export function mapText(points: GeoPoint[], weather: Record<string, WeatherValue>): string {
  if (!points.length) return "";
  const lines = points.map((point) => {
    const w = weather[point.id];
    const parts = [
      `${point.label}${point.klass ? ` (${point.klass})` : ""}`,
      `${point.lat.toFixed(4)}, ${point.lon.toFixed(4)}`,
    ];
    if (w) {
      parts.push(
        `Regen ${w.rain ?? "?"} mm/h, Wind ${w.wind ?? "?"} km/h, Temperatur ${w.temp ?? "?"} °C`,
      );
    }
    return `- ${parts.join(" · ")}`;
  });
  return `Objekte auf der Karte (${points.length}):\n${lines.join("\n")}`;
}

export function riskText(entries: RiskEntry[]): string {
  if (!entries.length) return "";
  const lines = entries
    .slice()
    .sort((a, b) => b.level - a.level)
    .map(
      (entry) =>
        `- ${entry.point.label}: Risiko ${entry.level} (${RISK_LABEL[entry.level]}), Wahrscheinlichkeit ${entry.likelihood}, Auswirkung ${entry.impact}`,
    );
  return `Risikolage (${entries.length} Objekte, höchste Stufe ${maxRisk(entries)}):\n${lines.join("\n")}`;
}

/** Colour for a finished risk level 1..5 (legend and lists). */
export function levelColor(level: number): string {
  const map: Record<number, string> = {
    1: "#16a34a",
    2: "#84cc16",
    3: "#eab308",
    4: "#ea580c",
    5: "#dc2626",
  };
  return map[Math.min(5, Math.max(1, Math.round(level)))] ?? "#16a34a";
}
