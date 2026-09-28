/**
 * Diagramm-Konfiguration: der Nutzer bestimmt die Daten, nie eine Heuristik.
 *
 * Drei Ebenen, eine Konfiguration:
 *  1. Vorschlag  — aus dem Tabellenaufbau abgeleitet, muss bestätigt werden.
 *  2. Visuell    — Kategorie, Messwert, Berechnung, Sortierung, Top N.
 *  3. Experte    — freie Leseabfrage (SQL) gegen die Tabelle `data`.
 *
 * Die Konfiguration liegt im Modul (`metadata.chartConfig`) und wird
 * serverseitig ausgeführt; im Browser landen nur die fertigen Balken.
 */
import type { ColumnSpec } from "@/lib/runtime/source-protocol";

export type ChartFn = "count" | "sum" | "avg" | "min" | "max";
export type ChartSort = "desc" | "asc" | "label";

export interface ChartConfig {
  /** "visual" = Auswahlfelder, "sql" = Experten-Modus. */
  mode: "visual" | "sql";
  groupBy: string | null;
  measure: string | null;
  fn: ChartFn;
  sort: ChartSort;
  limit: number;
  sql: string;
}

export const CHART_FUNCTIONS: { id: ChartFn; label: string }[] = [
  { id: "sum", label: "Summe" },
  { id: "avg", label: "Durchschnitt" },
  { id: "count", label: "Anzahl" },
  { id: "min", label: "Minimum" },
  { id: "max", label: "Maximum" },
];

export const CHART_SORTS: { id: ChartSort; label: string }[] = [
  { id: "desc", label: "Größte zuerst" },
  { id: "asc", label: "Kleinste zuerst" },
  { id: "label", label: "Alphabetisch" },
];

export const CHART_LIMITS = [5, 10, 25, 50, 100];
export const MAX_CHART_GROUPS = 200;

export const EMPTY_CHART_CONFIG: ChartConfig = {
  mode: "visual",
  groupBy: null,
  measure: null,
  fn: "count",
  sort: "desc",
  limit: 10,
  sql: "",
};

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

/** Konfiguration aus den Moduldaten lesen — fehlt sie, bleibt das Diagramm leer. */
export function readChartConfig(metadata: unknown): ChartConfig | null {
  const raw = (metadata as Record<string, unknown> | null | undefined)?.["chartConfig"];
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  const fn = CHART_FUNCTIONS.some((f) => f.id === value["fn"]) ? (value["fn"] as ChartFn) : "count";
  const sort = CHART_SORTS.some((s) => s.id === value["sort"])
    ? (value["sort"] as ChartSort)
    : "desc";
  const limit = Math.max(1, Math.min(MAX_CHART_GROUPS, Number(value["limit"]) || 10));
  return {
    mode: value["mode"] === "sql" ? "sql" : "visual",
    groupBy: str(value["groupBy"]),
    measure: str(value["measure"]),
    fn,
    sort,
    limit,
    sql: typeof value["sql"] === "string" ? value["sql"] : "",
  };
}

const NOISY_KEY =
  /(^|[_\s-])(id|uuid|name|vorname|nachname|email|e-mail|mail|url|link|telefon|phone|adresse|address|beschreibung|description|kommentar|notiz|note|text)([_\s-]|$)/i;
const GEO_KEY = /^(lat|lon|lng|long|latitude|longitude|breite|länge|laenge|x|y)$/i;

/**
 * Vorschlag aus dem Tabellenaufbau: eine Kategorie mit wenigen verschiedenen
 * Werten und ein echter Messwert. Der Vorschlag wird angezeigt, nie automatisch
 * angewandt — bestätigen muss ihn der Nutzer.
 */
export function suggestChartConfig(columns: ColumnSpec[]): ChartConfig | null {
  if (!columns.length) return null;
  const texts = columns.filter((c) => c.type !== "number" && !GEO_KEY.test(c.key));
  const numbers = columns.filter((c) => c.type === "number" && !GEO_KEY.test(c.key));
  const group = texts.find((c) => !NOISY_KEY.test(c.key)) ?? texts[0] ?? null;
  const measure = numbers.find((c) => !NOISY_KEY.test(c.key)) ?? numbers[0] ?? null;
  if (!group) return null;
  return {
    ...EMPTY_CHART_CONFIG,
    groupBy: group.key,
    measure: measure?.key ?? null,
    fn: measure ? "sum" : "count",
    sort: "desc",
    limit: 10,
  };
}

function labelOf(columns: ColumnSpec[], key: string | null): string {
  if (!key) return "";
  return columns.find((c) => c.key === key)?.label ?? key;
}

/** Kurze Beschreibung für Vorschlag und Statuszeile am Modul. */
export function describeChartConfig(config: ChartConfig, columns: ColumnSpec[]): string {
  if (config.mode === "sql") return "Eigene Abfrage (Experten-Modus)";
  if (!config.groupBy) return "Noch nicht eingerichtet";
  const fn = CHART_FUNCTIONS.find((f) => f.id === config.fn)?.label ?? config.fn;
  const measure = config.measure ? ` ${labelOf(columns, config.measure)}` : " Zeilen";
  const order = config.sort === "label" ? "A–Z" : config.sort === "asc" ? "kleinste" : "größte";
  return `${fn}${measure} je ${labelOf(columns, config.groupBy)} · Top ${config.limit} (${order})`;
}

function quote(key: string): string {
  return /^[a-z_][a-z0-9_]*$/.test(key) ? key : `"${key.replace(/"/g, '""')}"`;
}

/** Gleichwertige Leseabfrage zur visuellen Auswahl — Brücke in den Experten-Modus. */
export function chartConfigToSql(config: ChartConfig): string {
  if (config.mode === "sql") return config.sql;
  if (!config.groupBy) return "";
  const group = quote(config.groupBy);
  const measure = config.measure ? quote(config.measure) : null;
  const value =
    config.fn === "count" || !measure ? "count(*)" : `${config.fn}(${measure})`;
  const order =
    config.sort === "label" ? "name ASC" : config.sort === "asc" ? "value ASC" : "value DESC";
  return [
    `SELECT ${group} AS name, ${value} AS value`,
    "FROM data",
    `GROUP BY ${group}`,
    `ORDER BY ${order}`,
    `LIMIT ${config.limit}`,
  ].join("\n");
}

const FN_WORDS: [RegExp, ChartFn][] = [
  [/(durchschnitt|mittelwert|average|avg|mean)/i, "avg"],
  [/(summe|gesamt|total|sum|umsatz gesamt)/i, "sum"],
  [/(anzahl|count|wie viele|menge)/i, "count"],
  [/(minimum|kleinste|niedrigste|min\b)/i, "min"],
  [/(maximum|größte|hoechste|höchste|max\b)/i, "max"],
];

/**
 * Anweisung in Alltagssprache in eine Konfiguration übersetzen — deterministisch,
 * ohne Modellaufruf. Erkannt werden Spaltennamen, Berechnung, Sortierung und Top N.
 */
export function parseChartPrompt(
  prompt: string,
  columns: ColumnSpec[],
  base: ChartConfig,
): ChartConfig | null {
  const text = prompt.trim();
  if (!text) return null;
  const lower = text.toLowerCase();

  const hits = columns
    .map((c) => {
      const key = c.key.toLowerCase();
      const label = c.label.toLowerCase();
      const at = Math.max(lower.indexOf(key), lower.indexOf(label));
      return { column: c, at };
    })
    .filter((hit) => hit.at >= 0 && !GEO_KEY.test(hit.column.key))
    .sort((a, b) => a.at - b.at);

  const groupHit = hits.find((h) => h.column.type !== "number");
  const measureHit = hits.find((h) => h.column.type === "number");

  let fn: ChartFn | null = null;
  for (const [pattern, id] of FN_WORDS) {
    if (pattern.test(lower)) {
      fn = id;
      break;
    }
  }

  const top = /\btop\s*(\d{1,3})|\b(\d{1,3})\s*(größte|grösste|beste|wichtigste)/i.exec(text);
  const limit = top ? Number(top[1] ?? top[2]) : null;

  const sort: ChartSort = /(alphabet|a-z|a–z|nach name)/i.test(lower)
    ? "label"
    : /(kleinste|niedrigste|aufsteigend|schlechteste)/i.test(lower)
      ? "asc"
      : base.sort;

  if (!groupHit && !measureHit && !fn && !limit) return null;

  const measure = measureHit?.column.key ?? (fn && fn !== "count" ? base.measure : base.measure);
  return {
    ...base,
    mode: "visual",
    groupBy: groupHit?.column.key ?? base.groupBy,
    measure: fn === "count" ? null : measure,
    fn: fn ?? (measure ? "sum" : "count"),
    sort,
    limit: limit ? Math.max(1, Math.min(MAX_CHART_GROUPS, limit)) : base.limit,
  };
}
