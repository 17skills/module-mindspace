import { describe, expect, it } from "vitest";
import { ingestText } from "@/lib/runtime/ingestion";
import { trimEnvelope } from "@/lib/source-node";
import { riskRowsFromSource, sourceBrief, toLevel } from "@/lib/runtime/source-bridge";

function stored(text: string, name: string) {
  return trimEnvelope(ingestText(text, { sourceName: name, originKind: "file" }));
}

describe("Source → Logic Brücke", () => {
  it("überträgt Prozent- und Anteilswerte auf die fünf Stufen", () => {
    expect(toLevel(100, "percent")).toBe(5);
    expect(toLevel(20, "percent")).toBe(1);
    expect(toLevel(4, null)).toBe(4);
    expect(toLevel("", null)).toBeNull();
    expect(toLevel("keine Angabe", null)).toBeNull();
  });

  it("liest Risikozeilen aus einer Tabelle", () => {
    const source = stored(
      "Risiko;Eintritt;Auswirkung\nKabelalterung;4;5\nVegetation;2;3\n",
      "risiken.csv",
    );
    const rows = riskRowsFromSource(source);
    expect(rows).toHaveLength(2);
    expect(rows[0]?.label).toBe("Kabelalterung");
    expect(rows[0]?.chance).toBe(4);
    expect(rows[0]?.impact).toBe(5);
    expect(rows[0]?.missing).toEqual([]);
  });

  it("verwirft unvollständige Zeilen nicht, sondern weist die Lücke aus", () => {
    const source = stored("Risiko;Eintritt;Auswirkung\nHochwasser;;4\n", "luecke.csv");
    const rows = riskRowsFromSource(source);
    expect(rows[0]?.chance).toBeNull();
    expect(rows[0]?.missing).toEqual(["Eintritt"]);
  });

  it("liefert ohne passende Spalten keine Risikozeilen", () => {
    const source = stored("Name;Ort\nTrafo;Köln\n", "orte.csv");
    expect(riskRowsFromSource(source)).toHaveLength(0);
  });

  it("schreibt eine nachvollziehbare Entscheidungsgrundlage", () => {
    const source = stored("Risiko;Eintritt;Auswirkung\nKabelalterung;4;5\n", "risiken.csv");
    const brief = sourceBrief(source, [
      {
        ruleId: "budget",
        label: "Budgetgrenze",
        status: "violation",
        message: "68.000 EUR verletzt die Vorgabe höchstens 50.000 EUR.",
        subject: "betrag",
        actual: 68000,
        reference: "Unterschriftenrichtlinie 2.1",
        requires: "Vorstandsbeschluss",
        row: 3,
      },
    ]);
    expect(brief).toContain("risiken.csv");
    expect(brief).toContain("Kabelalterung");
    expect(brief).toContain("Regelbefunde");
    expect(brief).toContain("Zeile 3");
  });
});
