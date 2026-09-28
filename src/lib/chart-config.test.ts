import { describe, expect, it } from "vitest";
import {
  chartConfigToSql,
  parseChartPrompt,
  readChartConfig,
  suggestChartConfig,
  EMPTY_CHART_CONFIG,
} from "./chart-config";
import { validateReadOnlySql } from "./datasets";
import type { ColumnSpec } from "./runtime/source-protocol";

const col = (key: string, label: string, type: ColumnSpec["type"]): ColumnSpec => ({
  key,
  label,
  type,
  unit: null,
  semantic: null,
  filled: 10,
  total: 10,
});

const columns: ColumnSpec[] = [
  col("name", "Name", "text"),
  col("stadt", "Stadt", "text"),
  col("umsatz", "Umsatz", "number"),
  col("lat", "lat", "number"),
  col("lon", "lon", "number"),
];

describe("Diagramm-Konfiguration", () => {
  it("schlägt keine Namens- oder Geo-Spalte vor", () => {
    const suggestion = suggestChartConfig(columns);
    expect(suggestion?.groupBy).toBe("stadt");
    expect(suggestion?.measure).toBe("umsatz");
    expect(suggestion?.fn).toBe("sum");
  });

  it("liest gespeicherte Konfiguration und ignoriert Unsinn", () => {
    expect(readChartConfig({ chartConfig: { groupBy: "stadt" } })?.groupBy).toBe("stadt");
    expect(readChartConfig({ chartConfig: 5 })).toBeNull();
    expect(readChartConfig(null)).toBeNull();
  });

  it("übersetzt eine Anweisung in eine Konfiguration", () => {
    const next = parseChartPrompt("Top 5 durchschnitt umsatz je stadt", columns, {
      ...EMPTY_CHART_CONFIG,
    });
    expect(next?.groupBy).toBe("stadt");
    expect(next?.measure).toBe("umsatz");
    expect(next?.fn).toBe("avg");
    expect(next?.limit).toBe(5);
  });

  it("baut aus der Auswahl eine lesbare Abfrage", () => {
    const sql = chartConfigToSql({
      ...EMPTY_CHART_CONFIG,
      groupBy: "stadt",
      measure: "umsatz",
      fn: "sum",
      limit: 10,
    });
    expect(sql.toLowerCase()).toContain("select");
    expect(sql.toLowerCase()).toContain("from data");
    expect(validateReadOnlySql(sql)).toBeNull();
  });
});

describe("Schutz der freien Abfrage", () => {
  const blocked = [
    "delete from data",
    "select * from data; drop table data",
    "update data set umsatz = 0",
    "select * from pg_catalog.pg_tables",
    "select * from profiles",
    "select pg_sleep(10)",
  ];
  for (const query of blocked) {
    it(`lehnt ab: ${query}`, () => {
      expect(validateReadOnlySql(query)).not.toBeNull();
    });
  }

  it("erlaubt eine reine Leseabfrage", () => {
    expect(
      validateReadOnlySql("select stadt as name, sum(umsatz) as value from data group by 1"),
    ).toBeNull();
  });
});

import { configColumns, missingTemplateColumns } from "./chart-config";
describe("Abfragevorlagen", () => {
  it("erkennt benötigte Spalten visuell und in SQL", () => {
    expect(configColumns({ ...EMPTY_CHART_CONFIG, groupBy: "stadt", measure: "umsatz" }, [])).toEqual(["stadt", "umsatz"]);
    expect(
      configColumns({ ...EMPTY_CHART_CONFIG, mode: "sql", sql: "select stadt as name, count(*) as value from data group by 1" }, ["stadt", "umsatz", "name"]),
    ).toEqual(["stadt", "name"]);
    expect(missingTemplateColumns(["stadt", "umsatz"], ["stadt"])).toEqual(["umsatz"]);
  });
});
