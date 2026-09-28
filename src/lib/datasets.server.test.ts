/**
 * Integrationstests: verbundene Datentabelle → Karte (BBox) und Diagramm (Aggregation).
 *
 * Ein nachgebauter Datenbank-Client führt die RPCs `dataset_bbox` und
 * `dataset_aggregate` mit derselben Semantik wie die SQL-Funktionen aus
 * (Filter, Gruppierung, Deckel, matched/total). Geprüft wird der echte
 * Abfragemotor `runDatasetQuery`: welche benannten Argumente er sendet,
 * wie er Ergebnisse abbildet und dass er mit der Referenzlogik übereinstimmt.
 */
import { describe, expect, it } from "vitest";
import { runDatasetQuery } from "@/lib/datasets.server";
import { queryRows } from "@/lib/datasets";
import type { DataRow } from "@/lib/runtime/source-protocol";

const DATASET = "087f47ef-3a5e-4f0a-97be-4661e1ce48a7";
const CITIES = [
  { name: "Berlin", lat: 52.52, lon: 13.4 },
  { name: "Hamburg", lat: 53.55, lon: 10.0 },
  { name: "Muenchen", lat: 48.14, lon: 11.58 },
  { name: "Koeln", lat: 50.94, lon: 6.96 },
  { name: "Leipzig", lat: 51.34, lon: 12.37 },
];

function makeRows(n: number): DataRow[] {
  return Array.from({ length: n }, (_, i) => {
    const c = CITIES[i % CITIES.length]!;
    return {
      index: i,
      values: {
        name: `Kunde ${i}`,
        stadt: c.name,
        umsatz: String(100 + (i % 97) * 10),
        lat: String(c.lat + ((i % 10) - 5) * 0.01),
        lon: String(c.lon + ((i % 7) - 3) * 0.01),
      },
    };
  });
}

type Call = { fn: string; args: Record<string, unknown> };

function fakeClient(rows: DataRow[], opts: { failRpc?: boolean; storagePath?: string } = {}) {
  const calls: Call[] = [];
  const num = (v: unknown) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  const matchFilters = (r: DataRow, filters: { column: string; op: string; value?: unknown }[]) =>
    filters.every((f) => (f.op === "eq" ? String(r.values[f.column]) === String(f.value) : true));

  const rpc = async (fn: string, args: Record<string, unknown>) => {
    calls.push({ fn, args });
    if (opts.failRpc) return { data: null, error: { message: "boom" } };
    if (fn === "dataset_bbox") {
      const s = args._south as number | undefined;
      const w = args._west as number | undefined;
      const nn = args._north as number | undefined;
      const e = args._east as number | undefined;
      const hits = rows
        .map((r) => ({ r, lat: num(r.values.lat), lon: num(r.values.lon) }))
        .filter(
          (h) =>
            h.lat !== null &&
            h.lon !== null &&
            (s === undefined || h.lat >= s) &&
            (nn === undefined || h.lat <= nn) &&
            (w === undefined || h.lon >= w) &&
            (e === undefined || h.lon <= e),
        );
      const limit = Math.min(Math.max((args._limit as number) ?? 300, 1), 1000);
      const nameCol = args._name_col as string | undefined;
      return {
        data: hits.slice(0, limit).map((h) => ({
          row_index: h.r.index,
          lat: h.lat,
          lon: h.lon,
          name: nameCol ? String(h.r.values[nameCol] ?? "") : "",
          matched: hits.length,
          total: rows.length,
        })),
        error: null,
      };
    }
    if (fn === "dataset_aggregate") {
      const filters = (args._filters ?? []) as { column: string; op: string; value?: unknown }[];
      const matched = rows.filter((r) => matchFilters(r, filters));
      const groupBy = args._group_by as string | undefined;
      const measure = args._measure as string | undefined;
      const buckets = new Map<string, DataRow[]>();
      for (const r of matched) {
        const key = groupBy ? String(r.values[groupBy] ?? "–") : "Gesamt";
        buckets.set(key, [...(buckets.get(key) ?? []), r]);
      }
      const out = [...buckets.entries()].map(([bucket, list]) => {
        const vals = list.map((r) => num(r.values[measure ?? ""]) ?? 0);
        const value =
          args._fn === "count"
            ? list.length
            : args._fn === "sum"
              ? vals.reduce((a, b) => a + b, 0)
              : args._fn === "avg"
                ? vals.reduce((a, b) => a + b, 0) / vals.length
                : args._fn === "min"
                  ? Math.min(...vals)
                  : Math.max(...vals);
        return { bucket, value: String(value), cnt: list.length, matched: matched.length, total: rows.length };
      });
      out.sort((a, b) => Number(b.value) - Number(a.value));
      return { data: out.slice(0, 200), error: null };
    }
    return { data: null, error: { message: `unknown ${fn}` } };
  };

  const from = () => ({
    select: () => ({
      eq: () => ({
        maybeSingle: async () => ({
          data: {
            id: DATASET,
            version: 1,
            checksum: "abc",
            storage_path: opts.storagePath ?? null,
            row_count: rows.length,
            schema: {},
            verified: false,
          },
          error: null,
        }),
      }),
    }),
  });

  return { client: { rpc, from } as never, calls };
}

describe("Karte: Bounding-Box-Abfrage einer verbundenen Tabelle", () => {
  const rows = makeRows(5000);

  it("sendet benannte Argumente und liefert nur Punkte im Ausschnitt", async () => {
    const { client, calls } = fakeClient(rows);
    const { result } = await runDatasetQuery(client, DATASET, {
      mode: "bbox",
      mapping: { lat: "lat", lon: "lon", name: "name" },
      bbox: [52.4, 13.3, 52.6, 13.5],
      limit: 300,
    });
    expect(calls[0]).toEqual({
      fn: "dataset_bbox",
      args: {
        _dataset: DATASET,
        _limit: 300,
        _south: 52.4,
        _west: 13.3,
        _north: 52.6,
        _east: 13.5,
        _name_col: "name",
      },
    });
    expect(result.mode).toBe("bbox");
    expect(result.total).toBe(5000);
    expect(result.matched).toBe(1000); // nur Berlin
    expect(result.points).toHaveLength(300);
    expect(result.truncated).toBe(true);
    for (const p of result.points!) {
      expect(p.lat).toBeGreaterThanOrEqual(52.4);
      expect(p.lat).toBeLessThanOrEqual(52.6);
      expect(p.lon).toBeGreaterThanOrEqual(13.3);
      expect(p.lon).toBeLessThanOrEqual(13.5);
      expect(p.name).toMatch(/^Kunde \d+$/);
    }
  });

  it("deckelt überhöhte Limits auf höchstens 1.000 Punkte", async () => {
    const { client, calls } = fakeClient(rows);
    const { result } = await runDatasetQuery(client, DATASET, {
      mode: "bbox",
      mapping: { lat: "lat", lon: "lon" },
      limit: 999_999,
    });
    expect(calls[0]!.args._limit).toBe(1000);
    expect(calls[0]!.args).not.toHaveProperty("_south");
    expect(calls[0]!.args).not.toHaveProperty("_name_col");
    expect(result.points).toHaveLength(1000);
    expect(result.matched).toBe(5000);
  });

  it("leerer Ausschnitt ist nicht abgeschnitten", async () => {
    const { client } = fakeClient(rows);
    const { result } = await runDatasetQuery(client, DATASET, {
      mode: "bbox",
      mapping: { lat: "lat", lon: "lon" },
      bbox: [0, 0, 1, 1],
    });
    expect(result.points).toEqual([]);
    expect(result.total).toBe(5000);
    expect(result.truncated).toBe(false);
  });

  it("meldet Datenbankfehler verständlich", async () => {
    const { client } = fakeClient(rows, { failRpc: true });
    await expect(
      runDatasetQuery(client, DATASET, { mode: "bbox", mapping: { lat: "lat", lon: "lon" } }),
    ).rejects.toThrow("Kartenausschnitt konnte nicht geladen werden.");
  });
});

describe("Diagramm: serverseitige Aggregation einer verbundenen Tabelle", () => {
  const rows = makeRows(5000);

  it("summiert je Gruppe und stimmt mit der Referenzlogik überein", async () => {
    const { client, calls } = fakeClient(rows);
    const query = { mode: "aggregate", fn: "sum", groupBy: "stadt", measure: "umsatz", filters: [] } as const;
    const { result } = await runDatasetQuery(client, DATASET, query);
    expect(calls[0]).toEqual({
      fn: "dataset_aggregate",
      args: { _dataset: DATASET, _filters: [], _fn: "sum", _group_by: "stadt", _measure: "umsatz" },
    });
    expect(result.groups).toHaveLength(5);
    expect(result.matched).toBe(5000);
    expect(result.total).toBe(5000);
    expect(result.groups!.reduce((a, g) => a + g.count, 0)).toBe(5000);
    // absteigend sortiert
    const values = result.groups!.map((g) => g.value);
    expect(values).toEqual([...values].sort((a, b) => b - a));
    // gleiche Zahlen wie die In-Memory-Referenz
    const ref = queryRows(rows, query);
    const byKey = (gs: { key: string; value: number }[]) =>
      Object.fromEntries(gs.map((g) => [g.key, Math.round(g.value)]));
    expect(byKey(result.groups!)).toEqual(byKey(ref.groups!));
  });

  it("zählt ohne Kennzahl und lässt leere Argumente weg", async () => {
    const { client, calls } = fakeClient(rows);
    const { result } = await runDatasetQuery(client, DATASET, { mode: "aggregate", fn: "count" });
    expect(calls[0]!.args).toEqual({ _dataset: DATASET, _filters: [], _fn: "count" });
    expect(result.groups).toEqual([{ key: "Gesamt", value: 5000, count: 5000 }]);
  });

  it("wendet Filter in der Datenbank an", async () => {
    const { client } = fakeClient(rows);
    const { result } = await runDatasetQuery(client, DATASET, {
      mode: "aggregate",
      fn: "count",
      groupBy: "stadt",
      filters: [{ column: "stadt", op: "eq", value: "Leipzig" }],
    });
    expect(result.matched).toBe(1000);
    expect(result.groups).toEqual([{ key: "Leipzig", value: 1000, count: 1000 }]);
  });

  it("meldet Datenbankfehler verständlich", async () => {
    const { client } = fakeClient(rows, { failRpc: true });
    await expect(
      runDatasetQuery(client, DATASET, { mode: "aggregate", fn: "count" }),
    ).rejects.toThrow("Auswertung fehlgeschlagen.");
  });
});
