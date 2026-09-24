import type { NodeRecord } from "@/components/canvas/board-context";

/**
 * A factor card is a weighted list of parameters: every parameter carries a
 * share of the card (all shares add up to 100 %) and a condition score 1..10.
 * The card score is the weighted mean of its parameters.
 */
export type FactorParam = {
  id: string;
  label: string;
  /** Share of the card in percent. */
  weight: number;
  /** Condition / exposure on a 1..10 scale. */
  score: number;
  /** Where the value comes from: manual entry, table, metric, API. */
  source: string;
  /** Bewertung durch JEV — erst wirksam, wenn der Entscheider sie übernimmt. */
  jev?: { weight: number; score: number; reason: string; confidence?: number | null } | undefined;
};

export type FactorScore = {
  params: FactorParam[];
  /** Sum of all weights, should be 100. */
  weightSum: number;
  balanced: boolean;
  /** Weighted mean on the 1..10 scale. */
  score: number;
  /** Likelihood / impact 1..5 derived from the card score. */
  level: number;
  /** True when weights were saved, false when they were derived from the text. */
  stored: boolean;
};

function clampScore(value: unknown): number {
  const num = Number(value);
  if (!Number.isFinite(num)) return 5;
  return Math.min(10, Math.max(1, Math.round(num * 2) / 2));
}

function clampWeight(value: unknown): number {
  const num = Number(value);
  if (!Number.isFinite(num) || num < 0) return 0;
  return Math.min(100, Math.round(num * 10) / 10);
}

/** Parameters derived from the plain text lines of a card, evenly weighted. */
export function paramsFromText(content: string | null | undefined): FactorParam[] {
  const lines = (content ?? "")
    .split("\n")
    .map((line) => line.replace(/^[-•*]\s*/, "").trim())
    .filter(Boolean);
  if (!lines.length) return [];
  const share = Math.floor((100 / lines.length) * 10) / 10;
  return lines.map((line, index) => ({
    id: `p${index + 1}`,
    label: line.length > 80 ? `${line.slice(0, 77)}…` : line,
    weight: index === 0 ? Math.round((100 - share * (lines.length - 1)) * 10) / 10 : share,
    score: 5,
    source: "manuell",
  }));
}

export function scoreOf(params: FactorParam[]): number {
  const sum = params.reduce((total, param) => total + param.weight, 0);
  if (!sum) return 0;
  const weighted = params.reduce((total, param) => total + param.weight * param.score, 0);
  return Math.round((weighted / sum) * 10) / 10;
}

export function levelOf(score: number): number {
  if (!score) return 1;
  return Math.min(5, Math.max(1, Math.round(score / 2)));
}

/** Weighting of one factor card, saved values first, text as fallback. */
export function readFactor(record: NodeRecord | null | undefined): FactorScore {
  const meta = (record?.metadata ?? {}) as Record<string, unknown>;
  const raw = meta["params"];
  const stored = Array.isArray(raw) && raw.length > 0;
  const params: FactorParam[] = stored
    ? (raw as unknown[]).map((item, index) => {
        const row = (item ?? {}) as Record<string, unknown>;
        return {
          id: typeof row["id"] === "string" ? row["id"] : `p${index + 1}`,
          label: typeof row["label"] === "string" ? row["label"] : `Parameter ${index + 1}`,
          weight: clampWeight(row["weight"]),
          score: clampScore(row["score"]),
          source: typeof row["source"] === "string" ? (row["source"] as string) : "manuell",
          jev:
            row["jev"] && typeof row["jev"] === "object"
              ? (() => {
                  const j = row["jev"] as Record<string, unknown>;
                  return {
                    weight: clampWeight(j["weight"]),
                    score: clampScore(j["score"]),
                    reason: typeof j["reason"] === "string" ? j["reason"] : "",
                    confidence: typeof j["confidence"] === "number" ? j["confidence"] : null,
                  };
                })()
              : undefined,
        };
      })
    : paramsFromText(record?.content);
  const weightSum = Math.round(params.reduce((sum, param) => sum + param.weight, 0) * 10) / 10;
  const score = scoreOf(params);
  return {
    params,
    weightSum,
    balanced: Math.abs(weightSum - 100) < 0.5,
    score,
    level: levelOf(score),
    stored,
  };
}

/** Scale all weights so that they add up to exactly 100 %. */
export function normalizeWeights(params: FactorParam[]): FactorParam[] {
  if (!params.length) return params;
  const sum = params.reduce((total, param) => total + param.weight, 0);
  const even = Math.round((100 / params.length) * 10) / 10;
  const scaled = params.map((param) => ({
    ...param,
    weight: sum > 0 ? Math.round((param.weight / sum) * 1000) / 10 : even,
  }));
  const rest = Math.round((100 - scaled.reduce((total, p) => total + p.weight, 0)) * 10) / 10;
  const first = scaled[0];
  if (first) first.weight = Math.round((first.weight + rest) * 10) / 10;
  return scaled;
}

/** Theme weight of a background field in percent (0 when not set). */
export function readThemeWeight(record: NodeRecord | null | undefined): number {
  const meta = (record?.metadata ?? {}) as Record<string, unknown>;
  const value = Number(meta["weight"]);
  return Number.isFinite(value) && value > 0 ? Math.min(100, Math.round(value * 10) / 10) : 0;
}

export type ThemeScore = {
  id: string;
  title: string;
  weight: number;
  score: number;
  factors: number;
};

/** Overall weighting: theme shares × factor scores, on a 0..100 scale. */
export function themeIndex(themes: ThemeScore[]): number {
  const sum = themes.reduce((total, theme) => total + theme.weight, 0);
  if (!sum) return 0;
  const weighted = themes.reduce((total, theme) => total + theme.weight * theme.score, 0);
  return Math.round((weighted / sum) * 10);
}

/** Readable weighting summary handed to the decision module. */
export function factorText(name: string, factor: FactorScore): string {
  if (!factor.params.length) return "";
  const lines = factor.params.map(
    (param) =>
      `  · ${param.label}: Gewicht ${param.weight} % · Zustand ${param.score} / 10 · Quelle ${param.source}`,
  );
  return [
    `- ${name}: gewichteter Wert ${factor.score.toFixed(1)} / 10 (Stufe ${factor.level} / 5), Summe der Gewichte ${factor.weightSum} %`,
    ...lines,
  ].join("\n");
}
