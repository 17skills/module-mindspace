import { describe, expect, it } from "vitest";
import { zipSync, strToU8 } from "fflate";
import { ingestBytes, ingestText, ingestValue, ingestEvidence } from "./index";
import { detectFormat, sniffText } from "./sniffer";
import { parseCsv, parseDelimited, buildDataset } from "./table-adapter";
import { parseNumber, coerceValue, semanticOf } from "./typing";
import {
  cellLineage,
  describeEnvelope,
  envelopeSignal,
  primaryFacet,
} from "@/lib/runtime/source-protocol";

describe("sniffer", () => {
  it("erkennt Formate anhand von Inhalt", () => {
    expect(sniffText('{"a":1}')).toBe("json");
    expect(sniffText("rolle: Betriebsleiter\nlimit: 25000")).toBe("yaml");
    expect(sniffText("# Titel\n\nText")).toBe("markdown");
    expect(sniffText("a;b;c\n1;2;3")).toBe("csv");
    expect(sniffText("Freier Fließtext ohne Struktur.")).toBe("text");
  });

  it("erkennt Arbeitsmappen an den Magic Bytes", () => {
    const bytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04]);
    expect(detectFormat({ bytes })).toBe("xlsx");
  });
});

describe("typing", () => {
  it("liest deutsche und englische Zahlen", () => {
    expect(parseNumber("1.234,56")).toBeCloseTo(1234.56);
    expect(parseNumber("1,234.56")).toBeCloseTo(1234.56);
    expect(parseNumber("68.000 €")).toBe(68000);
    expect(parseNumber("abc")).toBeNull();
  });

  it("behandelt Lücken als Lücke, nicht als Fehler", () => {
    expect(coerceValue("").value).toBeNull();
    expect(coerceValue("n/a").value).toBeNull();
    expect(coerceValue("12.03.2026").value).toBe("2026-03-12");
  });

  it("vergibt leichte semantische Marker", () => {
    expect(semanticOf("Schaden in kEUR")).toBe("amount");
    expect(semanticOf("Eintrittswahrscheinlichkeit")).toBe("probability");
    expect(semanticOf("Zuständige Rolle")).toBe("role");
  });
});

describe("tabellarische Quellen", () => {
  it("liest Trennzeichen und Anführungszeichen", () => {
    const rows = parseDelimited('a;b\n"x;1";2\n', ";");
    expect(rows).toEqual([
      ["a", "b"],
      ["x;1", "2"],
    ]);
  });

  it("typisiert Spalten und misst Vollständigkeit", () => {
    const dataset = parseCsv("Anlage;Schaden EUR;Prio\nPumpe 4;68000;1\nTrafo 2;;3");
    expect(dataset.rowCount).toBe(2);
    const damage = dataset.columns.find((column) => column.key === "schaden_eur");
    expect(damage?.type).toBe("number");
    expect(damage?.unit).toBe("EUR");
    expect(damage?.semantic).toBe("amount");
    expect(damage?.filled).toBe(1);
    expect(dataset.rows[0]!.values["schaden_eur"]).toBe(68000);
    expect(dataset.rows[1]!.values["schaden_eur"]).toBeNull();
  });

  it("hält die Zeilennummer der Originaldatei", () => {
    const dataset = buildDataset([
      ["a"],
      ["1"],
      ["2"],
    ]);
    expect(dataset.rows.map((row) => row.index)).toEqual([2, 3]);
  });
});

describe("Arbeitsmappen", () => {
  function workbook(): Uint8Array {
    const sheet = `<?xml version="1.0"?><worksheet><sheetData>
      <row r="1"><c r="A1" t="inlineStr"><is><t>Anlage</t></is></c><c r="B1" t="inlineStr"><is><t>Schaden</t></is></c></row>
      <row r="2"><c r="A2" t="inlineStr"><is><t>Pumpe 4</t></is></c><c r="B2"><v>68000</v></c></row>
    </sheetData></worksheet>`;
    return zipSync({
      "xl/workbook.xml": strToU8('<workbook><sheets><sheet name="Risiken" sheetId="1"/></sheets></workbook>'),
      "xl/worksheets/sheet1.xml": strToU8(sheet),
    });
  }

  it("liest Zeilen, Spalten und den Blattnamen", () => {
    const envelope = ingestBytes(workbook(), { sourceName: "Revision.xlsx" });
    expect(envelope.meta.format).toBe("xlsx");
    expect(envelope.meta.container).toBe("Risiken");
    expect(envelope.facets.dataset?.rowCount).toBe(1);
    expect(envelope.facets.dataset?.rows[0]!.values["schaden"]).toBe(68000);
  });
});

describe("Envelope", () => {
  it("behandelt jede Quelle gleich und behält die Herkunft", () => {
    const table = ingestText("a;b\n1;2", { sourceName: "liste.csv" });
    const role = ingestText("role: Betriebsleiter\nlimit: 25000", { sourceName: "rolle.yaml" });
    const note = ingestText("# Notiz\n\nBitte prüfen.", { sourceName: "Notiz", originKind: "text" });

    for (const envelope of [table, role, note]) {
      expect(envelope.meta.sourceName).toBeTruthy();
      expect(envelope.meta.checksum).toHaveLength(16);
      expect(envelope.quality.completeness).toBeGreaterThanOrEqual(0);
    }
    expect(primaryFacet(table)).toBe("dataset");
    expect(primaryFacet(role)).toBe("entity");
    expect(primaryFacet(note)).toBe("document");
  });

  it("erzeugt für gleichen Inhalt die gleiche Prüfsumme", () => {
    const a = ingestText("a;b\n1;2", { sourceName: "x.csv" });
    const b = ingestText("a;b\n1;2", { sourceName: "x.csv" });
    expect(a.meta.checksum).toBe(b.meta.checksum);
    expect(a.id).toBe(b.id);
  });

  it("verweist auf Datei, Zeile und Spalte", () => {
    const envelope = ingestText("Anlage;Schaden\nPumpe 4;68000", { sourceName: "Trafo_Q3.csv" });
    expect(cellLineage(envelope, 2, "schaden")).toMatchObject({
      sourceName: "Trafo_Q3.csv",
      row: 2,
      column: "schaden",
    });
  });

  it("warnt bei Lücken statt zu scheitern", () => {
    const envelope = ingestText("Anlage;Schaden\nPumpe;\nTrafo;\nKessel;", {
      sourceName: "lueckig.csv",
    });
    expect(envelopeSignal(envelope)).toBe("warn");
    expect(envelope.quality.anomalies.length).toBeGreaterThan(0);
  });

  it("nimmt Strom- und Belegquellen mit demselben Vertrag auf", () => {
    const stream = ingestValue([{ id: 1, druck: 4.2 }], {
      sourceName: "MCP: Sensoren",
      originKind: "stream",
    });
    expect(stream.facets.dataset?.rowCount).toBe(1);

    const photo = ingestEvidence(
      {
        storageKey: "field-photos/a.jpg",
        mediaType: "image/jpeg",
        byteSize: 120_000,
        width: null,
        height: null,
        capturedAt: null,
      },
      { sourceName: "Befund.jpg" },
    );
    expect(primaryFacet(photo)).toBe("evidence");
    expect(describeEnvelope(photo)).toContain("Beleg");
  });

  it("fällt bei kaputter Struktur auf Text zurück", () => {
    const envelope = ingestText("{ kaputt: ", { sourceName: "defekt.json" });
    expect(primaryFacet(envelope)).toBe("document");
  });
});
