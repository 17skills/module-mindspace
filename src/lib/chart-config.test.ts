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

const columns: ColumnSpec[] = [
  { key: "name", label: "Name", type: "string" },
  { key: "stadt", label: "Stadt", type: "string" },
  { key: "umsatz", label: "Umsatz", type: "number" },
  { key: "lat", label: "lat", type: "number" },
  { key: "lon", label: "lon", type: "number" },
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
