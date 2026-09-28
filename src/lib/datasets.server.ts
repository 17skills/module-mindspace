/**
 * Abfragemotor der Datenablage.
 *
 * Gefiltert, gezählt und gerechnet wird in der Datenbank (`dataset_aggregate`,
 * `dataset_query_rows`, `dataset_bbox`, `dataset_rule_check`). Der Server hält
 * nie eine ganze Tabelle im Speicher; zurück kommen immer nur gedeckelte
 * Ergebnisse. Altbestände mit Datei-Ablage (`storage_path`) werden weiter
 * unterstützt, damit nichts verloren geht.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import {
  MAX_QUERY_ROWS,
  PREVIEW_ROWS,
  evaluateColumnRule,
  fromJsonl,
  queryRows,
  validateReadOnlySql,
  type DatasetQuery,
  type QueryResult,
} from "@/lib/datasets";
import type { DataRow } from "@/lib/runtime/source-protocol";

type Client = SupabaseClient<Database>;

export interface DatasetMeta {
  id: string;
  version: number;
  checksum: string;
  storagePath: string | null;
  rowCount: number;
  schema: unknown;
  verified: boolean;
}

export async function loadDatasetMeta(supabase: Client, datasetId: string): Promise<DatasetMeta> {
  const { data, error } = await supabase
    .from("datasets")
    .select("id,version,checksum,storage_path,row_count,schema,verified")
    .eq("id", datasetId)
    .maybeSingle();
  if (error || !data) throw new Error("Datenquelle nicht gefunden oder kein Zugriff.");
  return {
    id: data.id,
    version: data.version,
    checksum: data.checksum,
    storagePath: data.storage_path,
    rowCount: data.row_count,
    schema: data.schema,
    verified: data.verified,
  };
}

/** Altbestand: Zeilen liegen noch als Datei. Einmalig lesen, dann im Speicher filtern. */
async function legacyRows(path: string): Promise<DataRow[]> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: file, error } = await supabaseAdmin.storage.from("uploads").download(path);
  if (error || !file) throw new Error("Daten konnten nicht geladen werden.");
  return fromJsonl(await file.text());
}

function clamp(limit: number | undefined, fallback: number): number {
  return Math.max(1, Math.min(MAX_QUERY_ROWS, Math.floor(limit ?? fallback)));
}

/** Eine Abfrage für alle Empfänger — Karte, Diagramm, Agent, Regelwerk. */
export async function runDatasetQuery(
  supabase: Client,
  datasetId: string,
  query: DatasetQuery,
): Promise<{ version: number; checksum: string; result: QueryResult }> {
  const meta = await loadDatasetMeta(supabase, datasetId);
  const head = { version: meta.version, checksum: meta.checksum };

  if (meta.storagePath) {
    const rows = await legacyRows(meta.storagePath);
    return { ...head, result: queryRows(rows, query) };
  }

  if (query.mode === "aggregate") {
    const cap = Math.max(1, Math.min(200, Math.floor(query.limit ?? 200)));
    const { data, error } = await supabase.rpc("dataset_aggregate", {
      _dataset: datasetId,
      _filters: (query.filters ?? []) as never,
      _fn: query.fn,
      _sort: query.sort ?? "desc",
      _limit: cap,
      ...(query.groupBy ? { _group_by: query.groupBy } : {}),
      ...(query.measure ? { _measure: query.measure } : {}),
    });
    if (error) throw new Error("Auswertung fehlgeschlagen.");
    const groups = (data ?? []).map((row) => ({
      key: row.bucket,
      value: Number(row.value),
      count: Number(row.cnt),
    }));
    const first = data?.[0];
    return {
      ...head,
      result: {
        mode: "aggregate",
        total: Number(first?.total ?? meta.rowCount),
        matched: Number(first?.matched ?? 0),
        groups,
        truncated: groups.length >= cap,
      },
    };
  }

  if (query.mode === "bbox") {
    const limit = clamp(query.limit, 300);
    const box = query.bbox ?? null;
    const { data, error } = await supabase.rpc("dataset_bbox", {
      _dataset: datasetId,
      _limit: limit,
      ...(box ? { _south: box[0], _west: box[1], _north: box[2], _east: box[3] } : {}),
      ...(query.mapping.name ? { _name_col: query.mapping.name } : {}),
    });
    if (error) throw new Error("Kartenausschnitt konnte nicht geladen werden.");
    const points = (data ?? []).map((row) => ({
      lat: Number(row.lat),
      lon: Number(row.lon),
      name: row.name ?? "",
      index: row.row_index,
    }));
    const first = data?.[0];
    const matched = Number(first?.matched ?? points.length);
    return {
      ...head,
      result: {
        mode: "bbox",
        total: Number(first?.total ?? meta.rowCount),
        matched,
        points,
        truncated: matched > points.length,
      },
    };
  }

  const isPreview = query.mode === "preview";
  const limit = isPreview ? PREVIEW_ROWS : clamp(query.limit, 100);
  const offset = isPreview ? 0 : Math.max(0, Math.floor(query.offset ?? 0));
  const columns = isPreview ? null : (query.columns ?? null);
  const { data, error } = await supabase.rpc("dataset_query_rows", {
    _dataset: datasetId,
    _filters: (isPreview ? [] : (query.filters ?? [])) as never,
    _limit: limit,
    _offset: offset,
    ...(columns?.length ? { _columns: columns } : {}),
  });
  if (error) throw new Error("Zeilen konnten nicht geladen werden.");
  const rows = (data ?? []).map((row) => ({
    index: row.row_index,
    values: (row.data ?? {}) as Record<string, unknown>,
  }));
  const first = data?.[0];
  const matched = Number(first?.matched ?? rows.length);
  return {
    ...head,
    result: {
      mode: isPreview ? "preview" : "rows",
      total: Number(first?.total ?? meta.rowCount),
      matched,
      rows,
      truncated: matched > offset + rows.length,
    },
  };
}

/** Spaltenregel über die volle Tabelle — zurück kommen nur Zähler. */
export async function runDatasetRule(
  supabase: Client,
  datasetId: string,
  rule: { column: string; operator: string; value?: unknown },
): Promise<{
  version: number;
  total: number;
  passed: number;
  failed: number;
  failedRows: number[];
}> {
  const meta = await loadDatasetMeta(supabase, datasetId);
  if (meta.storagePath) {
    const rows = await legacyRows(meta.storagePath);
    return { version: meta.version, ...evaluateColumnRule(rows, rule) };
  }
  const { data, error } = await supabase.rpc("dataset_rule_check", {
    _dataset: datasetId,
    _column: rule.column,
    _operator: rule.operator,
    _value: (rule.value ?? null) as never,
  });
  if (error) throw new Error("Regel konnte nicht geprüft werden.");
  const row = data?.[0];
  return {
    version: meta.version,
    total: Number(row?.total ?? 0),
    passed: Number(row?.passed ?? 0),
    failed: Number(row?.failed ?? 0),
    failedRows: row?.failed_rows ?? [],
  };
}

/**
 * Experten-Modus: freie Leseabfrage gegen eine Tabelle.
 *
 * Die Datenbank ist die verbindliche Schranke: `dataset_sql` läuft mit den
 * Rechten des Nutzers (RLS), erlaubt ausschließlich Lesen, bricht nach drei
 * Sekunden ab und gibt höchstens 500 Zeilen zurück.
 */
export async function runDatasetSql(
  supabase: Client,
  datasetId: string,
  sql: string,
): Promise<{
  version: number;
  checksum: string;
  columns: string[];
  rows: Record<string, unknown>[];
}> {
  const problem = validateReadOnlySql(sql);
  if (problem) throw new Error(problem);
  const meta = await loadDatasetMeta(supabase, datasetId);
  if (meta.storagePath) {
    throw new Error("Für diese ältere Tabelle ist der Experten-Modus nicht verfügbar.");
  }
  const { data, error } = await supabase.rpc("dataset_sql", {
    _dataset: datasetId,
    _sql: sql,
  });
  if (error) throw new Error(error.message || "Abfrage fehlgeschlagen.");
  const rows = (data ?? []).map((row) => (row.row_json ?? {}) as Record<string, unknown>);
  const columns = rows.length ? Object.keys(rows[0]!) : [];
  return { version: meta.version, checksum: meta.checksum, columns, rows };
}
