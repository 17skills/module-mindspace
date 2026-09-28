import { describe, expect, it } from "vitest";
import {
  PREVIEW_ROWS,
  evaluateColumnRule,
  fromJsonl,
  needsStorage,
  queryRows,
  referenceEnvelope,
  rowsChecksum,
  toJsonl,
  datasetRefOf,
  detectGeoColumns,
  datasetSchemaBrief,
} from "./datasets";
import { ingestText } from "./runtime/ingestion";
import { stripData, sanitizeSettings } from "./runtime/manifest";
import { parseScopeSpec, validateScopeSpec, scopeSpecToManifest } from "./runtime/scope-spec";
import { coreCatalog } from "./runtime/catalog";
import type { DataRow } from "./runtime/source-protocol";

const rows: DataRow[] = Array.from({ length: 5000 }, (_, i) => ({
  index: i + 1,
  values: { name: `Anlage ${i}`, zustand: (i % 5) + 1, lat: 52 + (i % 100) / 1000, lon: 13 + (i % 100) / 1000, typ: i % 2 ? "Pumpe" : "Ventil" },
}));

describe("Datenablage", () => {
  it("lagert große Tabellen aus und behält nur Vorschau + Verweis", () => {
    const csv = ["name,wert", ...Array.from({ length: 50 }, (_, i) => `a${i},${i}`)].join("\n");
    const envelope = ingestText(csv, { sourceName: "t.csv" });
    expect(needsStorage(envelope)).toBe(true);
    const ref = { datasetId: "x", version: 1, checksum: "c", rowCount: 50, verified: false, sourceUrl: null, fetchedAt: null };
    const out = referenceEnvelope(envelope, ref);
    expect(out.facets.dataset!.rows).toHaveLength(PREVIEW_ROWS);
    expect(out.facets.dataset!.rowCount).toBe(50);
    expect(needsStorage(out)).toBe(false);
    expect(datasetRefOf({ source: { envelope: out } })?.version).toBe(1);
  });

  it("JSONL-Rundlauf und stabile Prüfsumme", () => {
    const back = fromJsonl(toJsonl(rows.slice(0, 10)) + "\nkaputt");
    expect(back).toHaveLength(10);
    expect(rowsChecksum(back)).toBe(rowsChecksum(rows.slice(0, 10)));
  });

  it("Abfragen sind gedeckelt", () => {
    expect(queryRows(rows, { mode: "rows", limit: 99999 }).rows).toHaveLength(1000);
    const filtered = queryRows(rows, { mode: "rows", filters: [{ column: "zustand", op: "gte", value: 4 }], columns: ["name"] });
    expect(filtered.matched).toBe(2000);
    expect(Object.keys(filtered.rows![0]!.values)).toEqual(["name"]);
  });

  it("Diagramm bekommt nur Zusammenfassung", () => {
    const agg = queryRows(rows, { mode: "aggregate", groupBy: "typ", measure: "zustand", fn: "avg" });
    expect(agg.groups).toHaveLength(2);
    expect(agg.rows).toBeUndefined();
  });

  it("Karte: Spaltenzuordnung und Ausschnitt", () => {
    const res = queryRows(rows, { mode: "bbox", mapping: { lat: "lat", lon: "lon", name: "name" }, bbox: [52, 13, 52.01, 13.01] });
    expect(res.points!.every((p) => p.lat <= 52.01)).toBe(true);
    expect(res.matched).toBeLessThan(5000);
  });

  it("Regel über 5.000 Zeilen liefert nur Zähler", () => {
    const res = evaluateColumnRule(rows, { column: "zustand", operator: "lte", value: 3 });
    expect(res).toMatchObject({ total: 5000, failed: 2000 });
    expect(res.failedRows.length).toBeLessThanOrEqual(20);
  });

  it("Bauplan trägt nie Daten", () => {
    const csv = ["a,b", "1,2", "3,4"].join("\n");
    const envelope = ingestText(csv, { sourceName: "k.csv" });
    const meta = { source: { envelope, truncated: 0 } };
    const clean = sanitizeSettings(stripData(meta)) as typeof meta;
    expect(clean.source.envelope.facets.dataset!.rows).toHaveLength(0);
    expect(clean.source.envelope.facets.dataset!.columns.length).toBe(2);
    expect(clean.source.envelope.facets.datasetRef!.datasetId).toBeNull();
  });
});

const SPEC = `
apiVersion: scopebuilder.io/v1alpha1
kind: Scope
metadata: { name: anlagen, version: 1.0.0, title: Anlagen }
spec:
  ontology:
    rules:
      - id: zustand
        label: Zustand ok
        subject: datasets.anlagen.columns.zustand
        operator: lte
        value: 3
      - id: falsch
        label: Unbekannte Spalte
        subject: datasets.anlagen.columns.farbe
  datasets:
    - id: anlagen
      title: Anlagenregister
      schema: { name: string, breite: number, laenge: number, zustand: number }
  modules:
    - id: karte
      ref: catalog:core/interactive-map@1.1.0
  bindings:
    - from: datasets.anlagen
      to: karte.inputs.dataset
      mapping: { lat: breite, lon: laenge, name: name }
`;

describe("scope mit Datenquellen", () => {
  it("prüft Spalten und bildet Verweis-Karten ab", () => {
    const spec = parseScopeSpec(SPEC);
    const { errors, warnings } = validateScopeSpec(spec, coreCatalog());
    expect(errors).toEqual([]);
    expect(warnings.some((w) => w.includes("farbe"))).toBe(true);
    const manifest = scopeSpecToManifest(spec, coreCatalog());
    const card = manifest.modules.find((m) => m.id === "datasets.anlagen")!;
    expect(card.type).toBe("source");
    const map = manifest.modules.find((m) => m.id === "karte")!;
    expect(map.settings["datasetMapping"]).toEqual({ dataset: { lat: "breite", lon: "laenge", name: "name" } });
    expect(manifest.links[0]).toMatchObject({ from: "datasets.anlagen", to: "karte" });
  });

  it("meldet fehlende Spaltenzuordnung, ohne abzubrechen", () => {
    const spec = parseScopeSpec(SPEC.replace("mapping: { lat: breite, lon: laenge, name: name }", "mapping: { lat: breite }"));
    const { errors, warnings } = validateScopeSpec(spec, coreCatalog());
    expect(errors).toEqual([]);
    expect(warnings.some((w) => w.includes("„lon"))).toBe(true);
  });
});

describe("Geo-Spalten und Schema-Kurzfassung", () => {
  it("erkennt Breiten- und Längengrad an gängigen Namen", () => {
    expect(detectGeoColumns([{ key: "lat", label: "lat" }, { key: "lon", label: "lon" }])).toEqual({
      lat: "lat",
      lon: "lon",
    });
    expect(
      detectGeoColumns([
        { key: "breitengrad", label: "Breitengrad" },
        { key: "laengengrad", label: "Längengrad" },
      ]),
    ).toEqual({ lat: "breitengrad", lon: "laengengrad" });
  });

  it("meldet keine Geo-Spalten, wenn eine Angabe fehlt", () => {
    expect(detectGeoColumns([{ key: "lat", label: "lat" }, { key: "umsatz", label: "Umsatz" }])).toBeNull();
  });

  it("gibt dem Agenten nur Spalten, niemals Zeilen", () => {
    const brief = datasetSchemaBrief(
      { columns: [{ key: "stadt", label: "Stadt", type: "text" }, { key: "umsatz", label: "Umsatz", type: "number" }] },
      5000,
      "abc",
    );
    expect(brief).toContain("stadt (text)");
    expect(brief).toContain("5.000 Zeilen");
    expect(brief).toContain("dataset_query");
    expect(brief).not.toContain("Kunde");
  });
});
