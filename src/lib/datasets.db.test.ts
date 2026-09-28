/**
 * Integrationstests gegen die echte Datenbank.
 *
 * Laufen nur, wenn DB_TEST_URL, DB_TEST_KEY, DB_TEST_TOKEN (Nutzersitzung) und
 * DB_TEST_DATASET gesetzt sind — sonst übersprungen. Start: `scripts/test-db.sh`.
 * Die SQL-Funktionen (`dataset_bbox`, `dataset_aggregate`) werden mit den
 * Rechten des Nutzers (RLS) aufgerufen und gegen eine unabhängige Nachrechnung
 * aus den Rohzeilen geprüft.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { runDatasetQuery } from "@/lib/datasets.server";

const env = process.env;
const url = env["DB_TEST_URL"];
const key = env["DB_TEST_KEY"];
const token = env["DB_TEST_TOKEN"];
const datasetId = env["DB_TEST_DATASET"];
const enabled = Boolean(url && key && token && datasetId);

type Row = { row_index: number; data: Record<string, unknown>; lat: number | null; lon: number | null };

describe.skipIf(!enabled)("Datenablage gegen echte Datenbank", () => {
  const supabase = enabled
    ? createClient<Database>(url!, key!, {
        auth: { persistSession: false, autoRefreshToken: false },
        global: { headers: { Authorization: `Bearer ${token}` } },
      })
    : (null as never);
  let rows: Row[] = [];
  const num = (v: unknown) => {
    const n = Number(String(v ?? "").replace(",", "."));
    return Number.isFinite(n) ? n : 0;
  };

  beforeAll(async () => {
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabase
        .from("dataset_rows")
        .select("row_index,data,lat,lon")
        .eq("dataset_id", datasetId!)
        .order("row_index")
        .range(from, from + 999);
      if (error) throw error;
      rows.push(...((data ?? []) as Row[]));
      if (!data || data.length < 1000) break;
    }
    expect(rows.length).toBeGreaterThan(0);
  }, 60_000);

  it("BBox liefert exakt die Punkte im Ausschnitt, gedeckelt", async () => {
    const withGeo = rows.filter((r) => r.lat !== null && r.lon !== null);
    const lats = withGeo.map((r) => r.lat!).sort((a, b) => a - b);
    const lons = withGeo.map((r) => r.lon!).sort((a, b) => a - b);
    // mittlerer Ausschnitt, damit innen und außen Punkte liegen
    const box: [number, number, number, number] = [
      lats[Math.floor(lats.length * 0.25)]!,
      lons[Math.floor(lons.length * 0.25)]!,
      lats[Math.floor(lats.length * 0.75)]!,
      lons[Math.floor(lons.length * 0.75)]!,
    ];
    const inside = withGeo.filter(
      (r) => r.lat! >= box[0] && r.lat! <= box[2] && r.lon! >= box[1] && r.lon! <= box[3],
    );
    const { result } = await runDatasetQuery(supabase, datasetId!, {
      mode: "bbox",
      mapping: { lat: "lat", lon: "lon" },
      bbox: box,
      limit: 300,
    });
    expect(result.total).toBe(rows.length);
    expect(result.matched).toBe(inside.length);
    expect(result.points!.length).toBe(Math.min(300, inside.length));
    expect(result.truncated).toBe(inside.length > 300);
    const allowed = new Set(inside.map((r) => r.row_index));
    for (const p of result.points!) {
      expect(allowed.has(p.index)).toBe(true);
    }
  });

  it("Aggregation (Summe je Gruppe) stimmt mit Nachrechnung überein", async () => {
    const keys = Object.keys(rows[0]!.data);
    const group = keys.find((k) => rows.some((r) => Number.isNaN(Number(r.data[k])))) ?? keys[0]!;
    const measure = keys.find((k) => k !== group && k !== "lat" && k !== "lon" && rows.every((r) => !Number.isNaN(Number(r.data[k]))));
    const expected = new Map<string, { sum: number; count: number }>();
    for (const r of rows) {
      const g = String(r.data[group] ?? "–");
      const e = expected.get(g) ?? { sum: 0, count: 0 };
      e.sum += measure ? num(r.data[measure]) : 1;
      e.count += 1;
      expected.set(g, e);
    }
    const { result } = await runDatasetQuery(supabase, datasetId!, {
      mode: "aggregate",
      fn: measure ? "sum" : "count",
      groupBy: group,
      measure: measure ?? null,
      filters: [],
    });
    expect(result.matched).toBe(rows.length);
    const top = result.groups!.slice(0, Math.min(200, expected.size));
    for (const g of top) {
      const e = expected.get(g.key)!;
      expect(e).toBeDefined();
      expect(g.count).toBe(e.count);
      expect(g.value).toBeCloseTo(e.sum, 2);
    }
    const values = result.groups!.map((g) => g.value);
    expect(values).toEqual([...values].sort((a, b) => b - a));
  });

  it("Filter wird in der Datenbank angewendet", async () => {
    const keys = Object.keys(rows[0]!.data);
    const col = keys.find((k) => rows.some((r) => Number.isNaN(Number(r.data[k])))) ?? keys[0]!;
    const value = String(rows[0]!.data[col]);
    const expected = rows.filter((r) => String(r.data[col]) === value).length;
    const { result } = await runDatasetQuery(supabase, datasetId!, {
      mode: "aggregate",
      fn: "count",
      filters: [{ column: col, op: "eq", value }],
    });
    expect(result.matched).toBe(expected);
    expect(result.groups).toEqual([{ key: "Gesamt", value: expected, count: expected }]);
  });
});
