import type { NodeRecord } from "@/components/canvas/board-context";

export type QuoteAsset = { id: string; label: string };

export type QuoteMark = {
  /** ISO timestamp of the recorded decision. */
  at: string;
  asset: string;
  label: string;
  buy: boolean;
  confidence: number | null;
  /** Price at the moment the decision was recorded. */
  price: number | null;
};

export type QuotesConfig = {
  assets: QuoteAsset[];
  currency: string;
  days: number;
  /** Price points per asset: [timestamp ms, price]. */
  series: Record<string, [number, number][]>;
  lastAt: string | null;
  marks: QuoteMark[];
};

export const DEFAULT_ASSETS: QuoteAsset[] = [
  { id: "bitcoin", label: "Bitcoin" },
  { id: "ethereum", label: "Ethereum" },
  { id: "solana", label: "Solana" },
  { id: "ripple", label: "XRP" },
];

export const QUOTE_COLORS = ["#2563eb", "#16a34a", "#d97706", "#db2777", "#0891b2", "#7c3aed"];

function str(raw: unknown, fallback = ""): string {
  return typeof raw === "string" && raw ? raw : fallback;
}

/** Settings and stored history of a quotes module (metadata). */
export function readQuotes(record: NodeRecord | undefined | null): QuotesConfig {
  const meta = (record?.metadata ?? {}) as Record<string, unknown>;
  const rawAssets = meta["assets"];
  const assets: QuoteAsset[] = Array.isArray(rawAssets) && rawAssets.length
    ? rawAssets.map((item, index) => {
        const row = (item ?? {}) as Record<string, unknown>;
        return {
          id: str(row["id"], `asset${index}`),
          label: str(row["label"], str(row["id"], `Wert ${index + 1}`)),
        };
      })
    : DEFAULT_ASSETS;

  const rawSeries = (meta["series"] ?? {}) as Record<string, unknown>;
  const series: Record<string, [number, number][]> = {};
  for (const [key, value] of Object.entries(rawSeries)) {
    if (!Array.isArray(value)) continue;
    series[key] = value
      .map((point) => (Array.isArray(point) ? [Number(point[0]), Number(point[1])] : [NaN, NaN]))
      .filter((point): point is [number, number] =>
        Number.isFinite(point[0]) && Number.isFinite(point[1]),
      );
  }

  const rawMarks = meta["marks"];
  const marks: QuoteMark[] = Array.isArray(rawMarks)
    ? rawMarks.map((item) => {
        const row = (item ?? {}) as Record<string, unknown>;
        const price = Number(row["price"]);
        const confidence = Number(row["confidence"]);
        return {
          at: str(row["at"], new Date().toISOString()),
          asset: str(row["asset"]),
          label: str(row["label"], str(row["asset"])),
          buy: row["buy"] === true,
          confidence: Number.isFinite(confidence) ? confidence : null,
          price: Number.isFinite(price) ? price : null,
        };
      })
    : [];

  const days = Number(meta["days"]);
  return {
    assets,
    currency: str(meta["currency"], "eur"),
    days: Number.isFinite(days) && days > 0 ? days : 7,
    series,
    lastAt: typeof meta["lastAt"] === "string" ? meta["lastAt"] : null,
    marks,
  };
}

/** Latest price of an asset out of the stored series. */
export function latestPrice(config: QuotesConfig, assetId: string): number | null {
  const points = config.series[assetId];
  if (!points || points.length === 0) return null;
  return points[points.length - 1]![1];
}

/** Price closest to a point in time (used to value a recorded decision). */
export function priceAt(config: QuotesConfig, assetId: string, at: string): number | null {
  const points = config.series[assetId];
  if (!points || points.length === 0) return null;
  const target = Date.parse(at);
  if (!Number.isFinite(target)) return null;
  let best = points[0]!;
  for (const point of points) {
    if (Math.abs(point[0] - target) < Math.abs(best[0] - target)) best = point;
  }
  return best[1];
}

export type MarkResult = QuoteMark & {
  now: number | null;
  changePct: number | null;
  /** true = the recommendation would have paid off, false = not, null = unknown. */
  correct: boolean | null;
};

/** Compares each recorded decision with the current price. */
export function evaluateMarks(config: QuotesConfig): MarkResult[] {
  return config.marks
    .map((mark) => {
      const start = mark.price ?? priceAt(config, mark.asset, mark.at);
      const now = latestPrice(config, mark.asset);
      const changePct =
        start && now && start !== 0 ? ((now - start) / start) * 100 : null;
      const correct = changePct === null ? null : mark.buy ? changePct > 0 : changePct <= 0;
      return { ...mark, price: start, now, changePct, correct };
    })
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
}

/** Share of recorded decisions that turned out right. */
export function hitRate(results: MarkResult[]): number | null {
  const judged = results.filter((item) => item.correct !== null);
  if (judged.length === 0) return null;
  return judged.filter((item) => item.correct).length / judged.length;
}

/** Chart rows: one entry per timestamp with the percentage change per asset. */
export function chartRows(config: QuotesConfig): Record<string, number | string>[] {
  const base: Record<string, number> = {};
  const stamps = new Set<number>();
  for (const asset of config.assets) {
    const points = config.series[asset.id];
    if (!points || points.length === 0) continue;
    base[asset.id] = points[0]![1];
    for (const point of points) stamps.add(point[0]);
  }
  const sorted = [...stamps].sort((a, b) => a - b);
  const step = Math.max(1, Math.ceil(sorted.length / 120));
  return sorted
    .filter((_, index) => index % step === 0 || index === sorted.length - 1)
    .map((stamp) => {
      const row: Record<string, number | string> = {
        t: new Date(stamp).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" }),
      };
      for (const asset of config.assets) {
        const points = config.series[asset.id];
        const start = base[asset.id];
        if (!points || !start) continue;
        let value: number | null = null;
        for (const point of points) {
          if (point[0] <= stamp) value = point[1];
          else break;
        }
        if (value !== null) row[asset.id] = Math.round(((value - start) / start) * 10000) / 100;
      }
      return row;
    });
}

/** Money formatting for prices. */
export function formatPrice(value: number | null, currency: string): string {
  if (value === null) return "–";
  const digits = Math.abs(value) >= 100 ? 0 : Math.abs(value) >= 1 ? 2 : 4;
  return value.toLocaleString("de-DE", {
    style: "currency",
    currency: currency.toUpperCase(),
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  });
}
