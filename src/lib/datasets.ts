/**
 * Daten getrennt vom Scope: reine Hilfen (Client und Server).
 *
 * Der Canvas hält nur einen Verweis (`DatasetRef`) und eine kleine Vorschau.
 * Alle Empfänger — Karte, Diagramm, Agent, Regelwerk — lesen über dieselben,
 * begrenzten Abfragen. Rohzeilen verlassen den Server nur gedeckelt.
 */
import type {
  DataRow,
  DatasetRef,
  SourceEnvelope,
  TabularDataset,
} from "@/lib/runtime/source-protocol";

export const PREVIEW_ROWS = 20;
export const MAX_QUERY_ROWS = 1000;
export const MAX_DATASET_ROWS = 200_000;

export type FilterOp = "eq" | "neq" | "gt" | "gte" | "lt" | "lte" | "contains" | "oneOf" | "filled";
export interface RowFilter {
  column: string;
  op: FilterOp;
  value?: unknown;
}

export type DatasetQuery =
  | { mode: "preview" }
  | { mode: "rows"; columns?: string[]; filters?: RowFilter[]; limit?: number; offset?: number }
  | {
      mode: "aggregate";
      groupBy?: string | null;
      measure?: string | null;
      fn: "count" | "sum" | "avg" | "min" | "max";
      filters?: RowFilter[];
      /** Sortierung der Gruppen: nach Wert oder nach Beschriftung. */
      sort?: "desc" | "asc" | "label";
      /** Top N Gruppen (höchstens 200). */
      limit?: number;
    }
  | {
      mode: "bbox";
      mapping: { lat: string; lon: string; name?: string };
      bbox?: [number, number, number, number] | null;
      limit?: number;
    };

export interface QueryResult {
  mode: DatasetQuery["mode"];
  total: number;
  matched: number;
  rows?: DataRow[];
  groups?: { key: string; value: number; count: number }[];
  points?: { lat: number; lon: number; name: string; index: number }[];
  truncated: boolean;
}

/** Hochgeladene Tabelle → Vorschau-Hülle mit Verweis. */
export function referenceEnvelope(envelope: SourceEnvelope, ref: DatasetRef): SourceEnvelope {
  const dataset = envelope.facets.dataset;
  if (!dataset) return envelope;
  return {
    ...envelope,
    facets: {
      ...envelope.facets,
      dataset: { ...dataset, rows: dataset.rows.slice(0, PREVIEW_ROWS), rowCount: ref.rowCount },
      datasetRef: ref,
    },
  };
}

export function readDatasetRef(envelope: SourceEnvelope | null | undefined): DatasetRef | null {
  const ref = envelope?.facets.datasetRef;
  return ref && typeof ref.rowCount === "number" ? ref : null;
}

/** Muss eine Tabelle ausgelagert werden? Kleine Vorgaben dürfen eingebettet bleiben. */
export function needsStorage(envelope: SourceEnvelope): boolean {
  const dataset = envelope.facets.dataset;
  return Boolean(dataset && !envelope.facets.datasetRef && dataset.rows.length > PREVIEW_ROWS);
}

export function toJsonl(rows: DataRow[]): string {
  return rows.map((row) => JSON.stringify(row)).join("\n");
}

export function fromJsonl(text: string): DataRow[] {
  const out: DataRow[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line) as DataRow;
      if (row && typeof row === "object" && row.values && typeof row.values === "object")
        out.push(row);
    } catch {
      // Kaputte Zeile überspringen, nie abbrechen.
    }
  }
  return out;
}

/** Stabile, kurze Prüfsumme (FNV-1a) — genügt zum Erkennen von Änderungen. */
export function rowsChecksum(rows: DataRow[]): string {
  let hash = 0x811c9dc5;
  const text = toJsonl(rows);
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

function num(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.replace(",", "."));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/** Zahl aus einer Zelle lesen (null, wenn die Zelle keine Zahl enthält). */
export const cellNumber = num;

const LAT_KEYS = ["lat", "latitude", "breite", "breitengrad", "y"];
const LON_KEYS = ["lon", "lng", "long", "longitude", "laenge", "länge", "längengrad", "x"];

function matchColumn(columns: { key: string; label: string }[], names: string[]): string | null {
  for (const column of columns) {
    const key = column.key.toLowerCase().trim();
    const label = column.label.toLowerCase().trim();
    if (names.includes(key) || names.includes(label)) return column.key;
  }
  return null;
}

/**
 * Koordinatenspalten erkennen. Sie werden beim Ablegen in eigene, indizierte
 * Spalten geschrieben, damit der Kartenausschnitt schnell abgefragt werden kann.
 */
export function detectGeoColumns(
  columns: { key: string; label: string }[],
): { lat: string; lon: string } | null {
  const lat = matchColumn(columns, LAT_KEYS);
  const lon = matchColumn(columns, LON_KEYS);
  return lat && lon ? { lat, lon } : null;
}

/** Kompakter Aufbau einer Tabelle für den Agenten — ohne eine einzige Datenzeile. */
export function datasetSchemaBrief(
  dataset: Pick<TabularDataset, "columns">,
  rowCount: number,
  datasetId: string | null,
): string {
  const columns = dataset.columns
    .map((c) => `${c.key} (${c.type}${c.unit ? `, ${c.unit}` : ""})`)
    .join("; ");
  return [
    `Datenquelle ${datasetId ?? "(nicht verbunden)"} mit ${rowCount.toLocaleString("de-DE")} Zeilen.`,
    `Spalten: ${columns}`,
    "Werte niemals raten: Zahlen, Treffer und Zeilen ausschließlich über das Werkzeug dataset_query abfragen.",
  ].join("\n");
}

function filled(value: unknown): boolean {
  return value !== null && value !== undefined && String(value).trim() !== "";
}

export function matchesFilter(row: DataRow, filter: RowFilter): boolean {
  const cell = row.values[filter.column];
  switch (filter.op) {
    case "filled":
      return filled(cell);
    case "contains":
      return String(cell ?? "")
        .toLowerCase()
        .includes(String(filter.value ?? "").toLowerCase());
    case "oneOf":
      return Array.isArray(filter.value) && filter.value.map(String).includes(String(cell));
    case "eq":
    case "neq": {
      const a = num(cell);
      const b = num(filter.value);
      const same =
        a !== null && b !== null ? a === b : String(cell ?? "") === String(filter.value ?? "");
      return filter.op === "eq" ? same : !same;
    }
    default: {
      const a = num(cell);
      const b = num(filter.value);
      if (a === null || b === null) return false;
      if (filter.op === "gt") return a > b;
      if (filter.op === "gte") return a >= b;
      if (filter.op === "lt") return a < b;
      return a <= b;
    }
  }
}

function applyFilters(rows: DataRow[], filters: RowFilter[] | undefined): DataRow[] {
  if (!filters?.length) return rows;
  return rows.filter((row) => filters.every((filter) => matchesFilter(row, filter)));
}

function clampLimit(limit: number | undefined): number {
  return Math.max(1, Math.min(MAX_QUERY_ROWS, Math.floor(limit ?? 100)));
}

/** Eine Abfrage für alle Empfänger — immer gedeckelt. */
export function queryRows(rows: DataRow[], query: DatasetQuery): QueryResult {
  const total = rows.length;
  if (query.mode === "preview") {
    return {
      mode: "preview",
      total,
      matched: total,
      rows: rows.slice(0, PREVIEW_ROWS),
      truncated: total > PREVIEW_ROWS,
    };
  }
  if (query.mode === "rows") {
    const matched = applyFilters(rows, query.filters);
    const limit = clampLimit(query.limit);
    const offset = Math.max(0, Math.floor(query.offset ?? 0));
    const cols = query.columns?.length ? new Set(query.columns) : null;
    const page = matched.slice(offset, offset + limit).map((row) =>
      cols
        ? {
            index: row.index,
            values: Object.fromEntries(Object.entries(row.values).filter(([k]) => cols.has(k))),
          }
        : row,
    );
    return {
      mode: "rows",
      total,
      matched: matched.length,
      rows: page,
      truncated: matched.length > offset + limit,
    };
  }
  if (query.mode === "aggregate") {
    const matched = applyFilters(rows, query.filters);
    const buckets = new Map<
      string,
      { sum: number; count: number; min: number; max: number; n: number }
    >();
    for (const row of matched) {
      const key = query.groupBy ? String(row.values[query.groupBy] ?? "–") : "Gesamt";
      const bucket = buckets.get(key) ?? { sum: 0, count: 0, min: Infinity, max: -Infinity, n: 0 };
      bucket.count += 1;
      const value = query.measure ? num(row.values[query.measure]) : null;
      if (value !== null) {
        bucket.sum += value;
        bucket.n += 1;
        bucket.min = Math.min(bucket.min, value);
        bucket.max = Math.max(bucket.max, value);
      }
      buckets.set(key, bucket);
    }
    const groups = [...buckets.entries()]
      .map(([key, b]) => {
        const value =
          query.fn === "count"
            ? b.count
            : query.fn === "sum"
              ? b.sum
              : query.fn === "avg"
                ? b.n
                  ? b.sum / b.n
                  : 0
                : query.fn === "min"
                  ? b.n
                    ? b.min
                    : 0
                  : b.n
                    ? b.max
                    : 0;
        return { key, value: Math.round(value * 1000) / 1000, count: b.count };
      })
      .sort((a, b) =>
        query.sort === "label"
          ? a.key.localeCompare(b.key, "de")
          : query.sort === "asc"
            ? a.value - b.value
            : b.value - a.value,
      );
    const cap = Math.max(1, Math.min(200, Math.floor(query.limit ?? 200)));
    const limited = groups.slice(0, cap);
    return {
      mode: "aggregate",
      total,
      matched: matched.length,
      groups: limited,
      truncated: groups.length > limited.length,
    };
  }
  const limit = clampLimit(query.limit ?? MAX_QUERY_ROWS);
  const points: NonNullable<QueryResult["points"]> = [];
  let matched = 0;
  for (const row of rows) {
    const lat = num(row.values[query.mapping.lat]);
    const lon = num(row.values[query.mapping.lon]);
    if (lat === null || lon === null || Math.abs(lat) > 90 || Math.abs(lon) > 180) continue;
    if (query.bbox) {
      const [south, west, north, east] = query.bbox;
      if (lat < south || lat > north || lon < west || lon > east) continue;
    }
    matched += 1;
    if (points.length < limit) {
      const name = query.mapping.name ? String(row.values[query.mapping.name] ?? "") : "";
      points.push({ lat, lon, name, index: row.index });
    }
  }
  return { mode: "bbox", total, matched, points, truncated: matched > points.length };
}

/** Regel-Subjekt `datasets.<id>.columns.<spalte>` zerlegen. */
export function parseColumnSubject(subject: string): { dataset: string; column: string } | null {
  const match = /^datasets\.([^.]+)\.columns\.(.+)$/.exec(subject);
  return match ? { dataset: match[1]!, column: match[2]! } : null;
}

const RULE_OP: Record<string, FilterOp> = {
  lte: "lte",
  gte: "gte",
  lt: "lt",
  gt: "gt",
  eq: "eq",
  neq: "neq",
  oneOf: "oneOf",
  required: "filled",
};

/**
 * Spaltenregel über alle Zeilen: Ergebnis sind nur Zähler und wenige
 * Zeilennummern, nie die Rohdaten.
 */
export function evaluateColumnRule(
  rows: DataRow[],
  rule: { column: string; operator: string; value?: unknown },
): { total: number; passed: number; failed: number; failedRows: number[] } {
  const op = RULE_OP[rule.operator];
  if (!op) return { total: rows.length, passed: rows.length, failed: 0, failedRows: [] };
  const failedRows: number[] = [];
  let failed = 0;
  for (const row of rows) {
    if (!matchesFilter(row, { column: rule.column, op, value: rule.value })) {
      failed += 1;
      if (failedRows.length < 20) failedRows.push(row.index);
    }
  }
  return { total: rows.length, passed: rows.length - failed, failed, failedRows };
}

/** Spalten eines Datensatzes auf Port-Felder abbilden (`mapping { lat: "Breite" }`). */
export function missingMappedColumns(
  dataset: Pick<TabularDataset, "columns">,
  mapping: Record<string, string>,
): string[] {
  const keys = new Set(dataset.columns.flatMap((c) => [c.key, c.label]));
  return Object.values(mapping).filter((column) => !keys.has(column));
}

/** Kompakte, verpackbare Beschreibung für Agenten: Aufbau, Kennzahlen, kleine Auswahl. */
export function agentBrief(dataset: TabularDataset, ref: DatasetRef | null): string {
  const columns = dataset.columns
    .map((c) => `${c.label} (${c.type}${c.unit ? `, ${c.unit}` : ""})`)
    .join("; ");
  const sample = dataset.rows
    .slice(0, 5)
    .map((row) => JSON.stringify(row.values))
    .join("\n");
  return [
    `Tabelle mit ${ref?.rowCount ?? dataset.rowCount} Zeilen${ref?.verified ? " (geprüfte Quelle)" : ""}.`,
    `Spalten: ${columns}`,
    "Beispielzeilen:",
    sample,
    "Weitere Zeilen nur über das Lese-Werkzeug dataset.query abrufen.",
  ].join("\n");
}

/** Verweis einer Karte für den Durchlauf-Nachweis (nur Id, Version, Prüfsumme). */
export function datasetRefOf(metadata: unknown): {
  datasetId: string | null;
  version: number;
  checksum: string;
  verified: boolean;
  sourceUrl: string | null;
} | null {
  const ref = (metadata as { source?: { envelope?: SourceEnvelope } } | null | undefined)?.source
    ?.envelope?.facets?.datasetRef;
  if (!ref) return null;
  return {
    datasetId: ref.datasetId,
    version: ref.version,
    checksum: ref.checksum,
    verified: ref.verified,
    sourceUrl: ref.sourceUrl,
  };
}
