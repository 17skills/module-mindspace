/**
 * Datenablage: vollständige Tabellen liegen getrennt vom Canvas, Zeile für
 * Zeile in der Datenbank (`dataset_rows`). Gefiltert, gezählt und gerechnet
 * wird in der Datenbank — der Server lädt nie die ganze Tabelle in den Speicher.
 * Rechte kommen aus den Scope-/Modulrechten (RLS auf `datasets`).
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  MAX_DATASET_ROWS,
  PREVIEW_ROWS,
  cellNumber,
  detectGeoColumns,
  queryRows,
  rowsChecksum,
  fromJsonl,
  evaluateColumnRule,
  type DatasetQuery,
  type QueryResult,
} from "@/lib/datasets";
import type { ColumnSpec, DataRow, DatasetRef } from "@/lib/runtime/source-protocol";

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

const rowSchema = z.object({ index: z.number(), values: z.record(z.string(), z.unknown()) });

const storeInput = z.object({
  nodeId: z.string().uuid(),
  columns: z.array(z.unknown()).max(500),
  rows: z.array(rowSchema).max(MAX_DATASET_ROWS).default([]),
  originKind: z.enum(["upload", "api", "verified"]).default("upload"),
  sourceUrl: z.string().url().startsWith("https://").nullable().default(null),
});

/** Neue Version einer Tabelle ablegen. Geprüfte Quellen: nur Adresse + Zeitpunkt. */
export const storeDataset = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => storeInput.parse(input))
  .handler(async ({ data, context }): Promise<DatasetRef> => {
    const { assertRate } = await import("@/lib/rate-limit.server");
    assertRate(`dataset:${context.userId}`, 30, 60_000);
    const { data: node, error: nodeError } = await context.supabase
      .from("nodes")
      .select("id,board_id")
      .eq("id", data.nodeId)
      .maybeSingle();
    if (nodeError || !node) throw new Error("Modul nicht gefunden oder kein Zugriff.");

    const verified = data.originKind === "verified";
    const rows = verified ? [] : (data.rows as DataRow[]);
    const { data: last } = await context.supabase
      .from("datasets")
      .select("version")
      .eq("node_id", data.nodeId)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();
    const version = (last?.version ?? 0) + 1;
    const checksum = verified ? "" : rowsChecksum(rows);
    const fetchedAt = new Date().toISOString();

    // Einfügen als Nutzer: RLS verlangt Bearbeitungsrecht am Modul.
    const { data: inserted, error } = await context.supabase
      .from("datasets")
      .insert({
        board_id: node.board_id,
        node_id: data.nodeId,
        version,
        checksum,
        schema: data.columns as never,
        row_count: verified ? 0 : rows.length,
        storage_path: null,
        origin_kind: data.originKind,
        verified,
        source_url: data.sourceUrl,
        fetched_at: fetchedAt,
        created_by: context.userId,
      })
      .select("id")
      .single();
    if (error || !inserted) {
      throw new Error("Keine Berechtigung, Daten an diesem Modul abzulegen.");
    }

    // Zeilen relational ablegen: Filter und Berechnungen laufen später in der
    // Datenbank, nicht im Serverspeicher.
    if (!verified && rows.length) {
      const geo = detectGeoColumns(data.columns as ColumnSpec[]);
      const payload = rows.map((row) => ({
        dataset_id: inserted.id,
        row_index: row.index,
        data: row.values as never,
        lat: geo ? cellNumber(row.values[geo.lat]) : null,
        lon: geo ? cellNumber(row.values[geo.lon]) : null,
      }));
      for (let i = 0; i < payload.length; i += 2000) {
        const { error: rowError } = await context.supabase
          .from("dataset_rows")
          .insert(payload.slice(i, i + 2000));
        if (rowError) {
          await (await admin()).from("datasets").delete().eq("id", inserted.id);
          throw new Error("Daten konnten nicht gespeichert werden.");
        }
      }
    }
    return {
      datasetId: inserted.id,
      version,
      checksum,
      rowCount: verified ? 0 : rows.length,
      verified,
      sourceUrl: data.sourceUrl,
      fetchedAt,
    };
  });

const filterSchema = z.object({
  column: z.string().max(200),
  op: z.enum(["eq", "neq", "gt", "gte", "lt", "lte", "contains", "oneOf", "filled"]),
  value: z.unknown().optional(),
});

const querySchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("preview") }),
  z.object({
    mode: z.literal("rows"),
    columns: z.array(z.string()).max(100).optional(),
    filters: z.array(filterSchema).max(20).optional(),
    limit: z.number().int().min(1).max(1000).optional(),
    offset: z.number().int().min(0).optional(),
  }),
  z.object({
    mode: z.literal("aggregate"),
    groupBy: z.string().nullable().optional(),
    measure: z.string().nullable().optional(),
    fn: z.enum(["count", "sum", "avg", "min", "max"]),
    filters: z.array(filterSchema).max(20).optional(),
    sort: z.enum(["desc", "asc", "label"]).optional(),
    limit: z.number().int().min(1).max(200).optional(),
  }),
  z.object({
    mode: z.literal("bbox"),
    mapping: z.object({ lat: z.string(), lon: z.string(), name: z.string().optional() }),
    bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]).nullable().optional(),
    limit: z.number().int().min(1).max(1000).optional(),
  }),
]);

/** Gefilterte, begrenzte Abfrage für Karte, Diagramm, Agent und Regelwerk. */
export const queryDataset = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z.object({ datasetId: z.string().uuid(), query: querySchema }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { assertRate } = await import("@/lib/rate-limit.server");
    assertRate(`dataset-q:${context.userId}`, 120, 60_000);
    const { runDatasetQuery } = await import("@/lib/datasets.server");
    const loaded = await runDatasetQuery(
      context.supabase as never,
      data.datasetId,
      data.query as DatasetQuery,
    );
    return {
      version: loaded.version,
      checksum: loaded.checksum,
      // JSON-Rundlauf: Zellwerte sind reine JSON-Werte.
      result: JSON.parse(JSON.stringify(loaded.result)) as Record<string, never>,
    };
  });

/** Spaltenregel über die volle Tabelle — zurück kommen nur Zähler. */
export const checkDatasetRule = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({
        datasetId: z.string().uuid(),
        column: z.string().max(200),
        operator: z.enum(["lte", "gte", "lt", "gt", "eq", "neq", "oneOf", "required"]),
        value: z.unknown().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { assertRate } = await import("@/lib/rate-limit.server");
    assertRate(`dataset-q:${context.userId}`, 120, 60_000);
    const { runDatasetRule } = await import("@/lib/datasets.server");
    return runDatasetRule(context.supabase as never, data.datasetId, data);
  });

/**
 * Experten-Modus: freie Leseabfrage. Die Datenbank prüft mit, führt nur lesend
 * aus, bricht nach drei Sekunden ab und gibt höchstens 500 Zeilen zurück.
 */
export const runDatasetSqlQuery = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({ datasetId: z.string().uuid(), sql: z.string().min(1).max(4000) })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { assertRate } = await import("@/lib/rate-limit.server");
    assertRate(`dataset-sql:${context.userId}`, 30, 60_000);
    const { runDatasetSql } = await import("@/lib/datasets.server");
    const loaded = await runDatasetSql(context.supabase as never, data.datasetId, data.sql);
    return {
      version: loaded.version,
      columns: loaded.columns,
      rows: JSON.parse(JSON.stringify(loaded.rows)) as Record<string, string | number | boolean | null>[],
    };
  });
