/**
 * Datenablage: vollständige Tabellen liegen getrennt vom Canvas.
 * Rechte kommen aus den Scope-/Modulrechten (RLS auf `datasets`).
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  MAX_DATASET_ROWS,
  queryRows,
  rowsChecksum,
  toJsonl,
  fromJsonl,
  evaluateColumnRule,
  type DatasetQuery,
} from "@/lib/datasets";
import type { DataRow, DatasetRef } from "@/lib/runtime/source-protocol";

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

    let storagePath: string | null = null;
    if (!verified) {
      storagePath = `datasets/${node.board_id}/${data.nodeId}/${version}.jsonl`;
      const db = await admin();
      const { error } = await db.storage
        .from("uploads")
        .upload(storagePath, new Blob([toJsonl(rows)], { type: "application/x-ndjson" }), { upsert: false });
      if (error) throw new Error("Daten konnten nicht gespeichert werden.");
    }

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
        storage_path: storagePath,
        origin_kind: data.originKind,
        verified,
        source_url: data.sourceUrl,
        fetched_at: fetchedAt,
        created_by: context.userId,
      })
      .select("id")
      .single();
    if (error || !inserted) {
      if (storagePath) await (await admin()).storage.from("uploads").remove([storagePath]);
      throw new Error("Keine Berechtigung, Daten an diesem Modul abzulegen.");
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
  }),
  z.object({
    mode: z.literal("bbox"),
    mapping: z.object({ lat: z.string(), lon: z.string(), name: z.string().optional() }),
    bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]).nullable().optional(),
    limit: z.number().int().min(1).max(1000).optional(),
  }),
]);

async function loadRows(
  supabase: { from: (t: "datasets") => any },
  datasetId: string,
): Promise<{ rows: DataRow[]; version: number; checksum: string }> {
  const { data: row, error } = await supabase
    .from("datasets")
    .select("id,storage_path,version,checksum,verified")
    .eq("id", datasetId)
    .maybeSingle();
  if (error || !row) throw new Error("Datenquelle nicht gefunden oder kein Zugriff.");
  if (!row.storage_path) return { rows: [], version: row.version, checksum: row.checksum };
  const db = await admin();
  const { data: file, error: fileError } = await db.storage.from("uploads").download(row.storage_path);
  if (fileError || !file) throw new Error("Daten konnten nicht geladen werden.");
  return { rows: fromJsonl(await file.text()), version: row.version, checksum: row.checksum };
}

/** Gefilterte, begrenzte Abfrage für Karte, Diagramm, Agent und Regelwerk. */
export const queryDataset = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z.object({ datasetId: z.string().uuid(), query: querySchema }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { assertRate } = await import("@/lib/rate-limit.server");
    assertRate(`dataset-q:${context.userId}`, 120, 60_000);
    const loaded = await loadRows(context.supabase as never, data.datasetId);
    return {
      version: loaded.version,
      checksum: loaded.checksum,
      result: queryRows(loaded.rows, data.query as DatasetQuery),
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
    const loaded = await loadRows(context.supabase as never, data.datasetId);
    return { version: loaded.version, ...evaluateColumnRule(loaded.rows, data) };
  });
