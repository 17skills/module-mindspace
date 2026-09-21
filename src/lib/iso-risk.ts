import type { NodeRecord } from "@/components/canvas/board-context";
import { readStructure } from "@/lib/structure";
import type { GeoPoint, WeatherValue } from "@/lib/geo";

/** A single risk field of the ISO 55001 / ISO 31000 assessment. */
export type RiskField = {
  id: string;
  code: string;
  name: string;
  /** Evidence note, shown as a hint in the module. */
  note: string;
  /** Likelihood 1..5 */
  chance: number;
  /** Impact 1..5 */
  impact: number;
  /** Where the likelihood comes from: manual, live weather, asset age or a factor card. */
  auto: "none" | "weather" | "age" | "factor";
  /** Id of the connected factor card when auto === "factor". */
  factorId?: string;
  /** Own measured value, overrides the live measurement when set. */
  measureText?: string;
  /** Own threshold, overrides the automatic threshold when set. */
  limitText?: string;
};

/** One tracked edit of the risk table, used for the change log and undo. */
export type RiskChange = {
  id: string;
  at: number;
  fieldId: string;
  code: string;
  label: string;
  key: "name" | "note" | "chance" | "impact" | "auto" | "measureText" | "limitText" | "factorId";
  from: string | number | undefined;
  to: string | number | undefined;
};

export type IsoRiskConfig = {
  fields: RiskField[];
  /** Newest first change log of the table. */
  history: RiskChange[];
  rainWarn: number;
  rainDanger: number;
  windWarn: number;
  windDanger: number;
};

export const LIKELIHOOD_LABEL: Record<number, string> = {
  1: "Nahezu ausgeschlossen",
  2: "Unwahrscheinlich",
  3: "Möglich",
  4: "Wahrscheinlich",
  5: "Fast sicher",
};

export const IMPACT_LABEL: Record<number, string> = {
  1: "Unerheblich",
  2: "Gering",
  3: "Moderat",
  4: "Erheblich",
  5: "Katastrophal",
};

export const DEFAULT_FIELDS: RiskField[] = [
  {
    id: "r1",
    code: "R1",
    name: "Wetter- & Klimarisiken",
    note: "Sturm, Eislast, Hochwasser, Hitze, Vegetation an Trassen",
    chance: 4,
    impact: 4,
    auto: "weather",
  },
  {
    id: "r2",
    code: "R2",
    name: "Anlagenalterung",
    note: "Kabel über Nutzungsdauer, Zustand unbekannt, Ersatzteile knapp",
    chance: 5,
    impact: 4,
    auto: "age",
  },
  {
    id: "r3",
    code: "R3",
    name: "Netzkapazität & Lastwachstum",
    note: "Wärmepumpen, E-Mobilität, PV-Rückspeisung, §14a EnWG",
    chance: 5,
    impact: 5,
    auto: "none",
  },
  {
    id: "r4",
    code: "R4",
    name: "Regulatorik & Finanzierung",
    note: "ARegV, Effizienzvorgaben, Kapitalkosten, Zinsniveau",
    chance: 3,
    impact: 4,
    auto: "none",
  },
];

function clamp(value: unknown, fallback: number): number {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(5, Math.max(1, Math.round(num)));
}

function numberOr(value: unknown, fallback: number): number {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

export function readIsoRisk(record: NodeRecord | null | undefined): IsoRiskConfig {
  const meta = (record?.metadata ?? {}) as Record<string, unknown>;
  const raw = meta["fields"];
  const fields: RiskField[] = Array.isArray(raw)
    ? raw.map((item, index) => {
        const row = (item ?? {}) as Record<string, unknown>;
        const auto = row["auto"];
        return {
          id: typeof row["id"] === "string" ? row["id"] : `r${index + 1}`,
          code: typeof row["code"] === "string" ? row["code"] : `R${index + 1}`,
          name: typeof row["name"] === "string" ? row["name"] : `Risiko ${index + 1}`,
          note: typeof row["note"] === "string" ? row["note"] : "",
          chance: clamp(row["chance"], 3),
          impact: clamp(row["impact"], 3),
          auto:
            auto === "weather" || auto === "age" || auto === "factor" ? auto : "none",
          ...(typeof row["factorId"] === "string" ? { factorId: row["factorId"] } : {}),
          ...(typeof row["measureText"] === "string" ? { measureText: row["measureText"] } : {}),
          ...(typeof row["limitText"] === "string" ? { limitText: row["limitText"] } : {}),
        };
      })
    : DEFAULT_FIELDS.map((field) => ({ ...field }));
  const rawHistory = meta["history"];
  const history: RiskChange[] = Array.isArray(rawHistory)
    ? (rawHistory.filter(
        (item) => item && typeof item === "object" && typeof (item as RiskChange).key === "string",
      ) as RiskChange[])
    : [];
  return {
    fields,
    history,
    rainWarn: numberOr(meta["rainWarn"], 5),
    rainDanger: numberOr(meta["rainDanger"], 25),
    windWarn: numberOr(meta["windWarn"], 40),
    windDanger: numberOr(meta["windDanger"], 75),
  };
}

/** Human readable name of an edited cell, used in the change log. */
export const CHANGE_LABEL: Record<RiskChange["key"], string> = {
  name: "Risiko",
  note: "Nachweis",
  chance: "Eintritt (E)",
  impact: "Auswirkung (A)",
  auto: "Datenquelle",
  measureText: "Messwert",
  limitText: "Grenzwert",
};

/** Colour of a matrix cell / score, following the ISO legend. */
export function scoreColor(score: number): string {
  if (score >= 20) return "#e8a09a";
  if (score >= 12) return "#f0b884";
  if (score >= 6) return "#f5dda0";
  if (score >= 3) return "#bcdcc2";
  return "#b8cfe8";
}

export const STEP_LABEL: Record<string, string> = {
  blue: "Sehr niedrig",
  green: "Niedrig",
  yellow: "Mittel",
  orange: "Hoch",
  red: "Sehr hoch",
};

export function stepOf(score: number): string {
  if (score >= 20) return "Sehr hoch";
  if (score >= 12) return "Hoch";
  if (score >= 6) return "Mittel";
  if (score >= 3) return "Niedrig";
  return "Sehr niedrig";
}

export type RiskClass = {
  key: "A" | "B" | "C" | "D";
  label: string;
  action: string;
  range: string;
  color: string;
};

export const RISK_CLASSES: RiskClass[] = [
  {
    key: "A",
    label: "A – akzeptabel",
    action: "Überwachen im Regelzyklus",
    range: "Score 1 – 5",
    color: "#bcdcc2",
  },
  {
    key: "B",
    label: "B – tolerierbar",
    action: "Maßnahmen prüfen, Ziele anpassen",
    range: "Score 6 – 10",
    color: "#f5dda0",
  },
  {
    key: "C",
    label: "C – kritisch",
    action: "Maßnahmenplan und Budget (SAMP)",
    range: "Score 12 – 16",
    color: "#f0b884",
  },
  {
    key: "D",
    label: "D – inakzeptabel",
    action: "Sofortmaßnahmen, Eskalation",
    range: "Score 20 – 25",
    color: "#e8a09a",
  },
];

export function classOf(score: number): RiskClass {
  if (score >= 20) return RISK_CLASSES[3]!;
  if (score >= 12) return RISK_CLASSES[2]!;
  if (score >= 6) return RISK_CLASSES[1]!;
  return RISK_CLASSES[0]!;
}

/** Likelihood 1..5 derived from the worst current weather across all points. */
export function weatherChance(
  points: GeoPoint[],
  weather: Record<string, WeatherValue>,
  config: IsoRiskConfig,
): number | null {
  const values = points.map((point) => weather[point.id]).filter(Boolean) as WeatherValue[];
  if (!values.length) return null;
  let worst = 1;
  for (const value of values) {
    const rain = value.rain ?? 0;
    const wind = value.wind ?? 0;
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
    worst = Math.max(worst, rainLevel, windLevel);
  }
  return worst;
}

const AGE_NAMES = ["baujahr", "inbetriebnahme", "jahr", "alter", "year", "inbetriebnahmedatum"];

/** Likelihood 1..5 from the average age of assets in connected tables. */
export function ageChance(sources: NodeRecord[]): { level: number; years: number } | null {
  const ages: number[] = [];
  const thisYear = new Date().getFullYear();
  for (const source of sources) {
    if (source.type !== "table" && source.type !== "list") continue;
    const data = readStructure(source);
    const index = data.columns.findIndex((column) =>
      AGE_NAMES.some((name) => column.trim().toLowerCase().includes(name)),
    );
    if (index < 0) continue;
    for (const row of data.rows) {
      const raw = String(row[index] ?? "");
      const year = Number(raw.match(/\d{4}/)?.[0] ?? NaN);
      if (Number.isFinite(year) && year > 1900 && year <= thisYear) {
        ages.push(thisYear - year);
      } else {
        const plain = Number(raw.replace(",", "."));
        if (Number.isFinite(plain) && plain > 0 && plain < 120) ages.push(plain);
      }
    }
  }
  if (!ages.length) return null;
  const years = ages.reduce((sum, value) => sum + value, 0) / ages.length;
  const level = years >= 35 ? 5 : years >= 25 ? 4 : years >= 15 ? 3 : years >= 8 ? 2 : 1;
  return { level, years: Math.round(years) };
}

export type IsoResult = {
  fields: (RiskField & { score: number; klass: RiskClass })[];
  highest: number;
  index: number;
  portfolio: RiskClass;
};

export function evaluate(fields: RiskField[]): IsoResult {
  const scored = fields.map((field) => {
    const score = field.chance * field.impact;
    return { ...field, score, klass: classOf(score) };
  });
  const highest = scored.reduce((max, field) => Math.max(max, field.score), 0);
  const total = scored.reduce((sum, field) => sum + field.score, 0);
  const index = scored.length ? Math.round((total / (scored.length * 25)) * 100) : 0;
  return { fields: scored, highest, index, portfolio: classOf(highest) };
}

/** Live evidence behind the likelihood of one row, shown like a spreadsheet cell. */
export type RiskMeasure = {
  /** Measured value as text, e.g. "58 km/h" — null when nothing was measured yet. */
  text: string | null;
  /** Threshold the value is compared against. */
  limit: string | null;
  /** True when the measurement is at or above the threshold. */
  breach: boolean;
  /** The rule in words, like a formula in a cell. */
  rule: string;
  /** Where the number comes from. */
  source: string;
};

export type RiskContext = {
  config: IsoRiskConfig;
  weatherLevel: number | null;
  peakWind: number | null;
  peakRain: number | null;
  ageYears: number | null;
  ageLevel: number | null;
};

function num(value: number | null, digits = 0): string | null {
  if (value == null || !Number.isFinite(value)) return null;
  return value.toLocaleString("de-DE", { maximumFractionDigits: digits });
}

/** Measurement and threshold with the user's own values applied. */
function withOverrides(field: RiskField, base: RiskMeasure): RiskMeasure {
  const own = field.measureText?.trim();
  const ownLimit = field.limitText?.trim();
  if (!own && !ownLimit) return base;
  return {
    ...base,
    text: own ? own : base.text,
    limit: ownLimit ? ownLimit : base.limit,
    source: own ? "eigener Eintrag" : base.source,
  };
}

/** The evidence cell of a risk row: measured value, threshold and rule. */
export function measureOf(field: RiskField, ctx: RiskContext): RiskMeasure {
  return withOverrides(field, baseMeasure(field, ctx));
}

function baseMeasure(field: RiskField, ctx: RiskContext): RiskMeasure {
  if (field.auto === "weather") {
    const wind = num(ctx.peakWind);
    const rain = num(ctx.peakRain, 1);
    const parts = [wind ? `${wind} km/h Böen` : null, rain ? `${rain} mm/h Regen` : null].filter(
      Boolean,
    );
    return {
      text: parts.length ? parts.join(" · ") : null,
      limit: `${num(ctx.config.windDanger)} km/h · ${num(ctx.config.rainDanger, 1)} mm/h`,
      breach:
        (ctx.peakWind ?? 0) >= ctx.config.windWarn || (ctx.peakRain ?? 0) >= ctx.config.rainWarn,
      rule: "Eintritt = Stufe der schlechtesten Wettermeldung (1 – 5)",
      source: "Wetter der Karte",
    };
  }
  if (field.auto === "age") {
    return {
      text: ctx.ageYears == null ? null : `Ø ${num(ctx.ageYears)} Jahre`,
      limit: "25 Jahre",
      breach: (ctx.ageYears ?? 0) >= 25,
      rule: "Eintritt = 5 ab 35 J., 4 ab 25 J., 3 ab 15 J., 2 ab 8 J.",
      source: "Baujahr der Anlagentabelle",
    };
  }
  return {
    text: null,
    limit: null,
    breach: false,
    rule: "Eintritt von Hand gesetzt",
    source: field.note || "eigene Einschätzung",
  };
}

/** Step by step explanation of one score, shown when a score is clicked. */
export type ScoreExplain = {
  formula: string;
  inputs: { label: string; value: string; hint: string }[];
  reason: string;
  next: string;
};

export function explainScore(
  field: RiskField & { score: number; klass: RiskClass },
  measure: RiskMeasure,
): ScoreExplain {
  const source =
    field.auto === "weather"
      ? "aus dem Wetter der Karte berechnet"
      : field.auto === "age"
        ? "aus dem Baujahr der Anlagentabelle berechnet"
        : "von Hand gesetzt";
  return {
    formula: `Score = Eintritt × Auswirkung = ${field.chance} × ${field.impact} = ${field.score}`,
    inputs: [
      {
        label: "Eintritt (E)",
        value: `${field.chance} – ${LIKELIHOOD_LABEL[field.chance]}`,
        hint: source,
      },
      {
        label: "Auswirkung (A)",
        value: `${field.impact} – ${IMPACT_LABEL[field.impact]}`,
        hint: "von Hand gesetzt",
      },
      { label: "Messwert", value: measure.text ?? "kein Messwert", hint: measure.source },
      {
        label: "Grenzwert",
        value: measure.limit ?? "kein Grenzwert",
        hint: measure.breach ? "Messwert erreicht oder überschreitet den Grenzwert" : "Messwert liegt darunter",
      },
    ],
    reason: `${field.score} liegt im Bereich ${field.klass.range}. Deshalb gilt Klasse ${field.klass.key}: ${field.klass.label}.`,
    next: field.klass.action,
  };
}

/** Readable summary handed to the decision module and chat. */
export function isoText(result: IsoResult): string {
  if (!result.fields.length) return "";
  const lines = result.fields
    .slice()
    .sort((a, b) => b.score - a.score)
    .map(
      (field) =>
        `- ${field.code} ${field.name}: Eintritt ${field.chance} (${LIKELIHOOD_LABEL[field.chance]}) × Auswirkung ${field.impact} (${IMPACT_LABEL[field.impact]}) = ${field.score} → Klasse ${field.klass.label}, ${field.klass.action}`,
    );
  return [
    `Risikobewertung nach ISO 55001 / ISO 31000 (${result.fields.length} Risiken):`,
    ...lines,
    `Höchster Einzelscore ${result.highest} · Portfolio-Index ${result.index} / 100 · Portfolio-Klasse ${result.portfolio.label} (${result.portfolio.action}).`,
  ].join("\n");
}
