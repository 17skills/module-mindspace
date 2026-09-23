import { describe, expect, it } from "vitest";
import { ingestText } from "@/lib/runtime/ingestion";
import {
  effectCaution,
  missingInputs,
  runEvaluate,
  stageEffect,
  type UnitSpec,
} from "@/lib/runtime/unit-spec";

const table = ingestText("Risiko;Eintritt\nKabelalterung;4\n", {
  sourceName: "risiken.csv",
  originKind: "file",
});

const sumUnit: UnitSpec<number, { factor: number }> = {
  kind: "logic",
  type: "test.sum",
  label: "Summe",
  inputs: [{ id: "data", label: "Datenquelle", accepts: ["dataset"], required: true }],
  emits: null,
  evaluate: (input, state) => {
    const rows = input.ports["data"]?.facets.dataset?.rows ?? [];
    return {
      status: "ok",
      output: rows.length * state.factor,
      signal: {
        status: "ok",
        display: `${rows.length} Zeilen`,
        confidence: 1,
        completeness: 1,
        findings: [],
        facet: "dataset",
        explanation: { headline: "Gerechnet", cause: null, remedy: null },
      },
      notes: [],
    };
  },
  prepareEffect: (result) => ({
    id: "eff_1",
    unitId: "u1",
    summary: "E-Mail an Betriebsleitung senden",
    channel: "email",
    payload: { total: result.output },
    rationale: "Schwellenwert überschritten",
    status: result.status,
    irreversible: false,
    preparedAt: "2026-01-01T00:00:00.000Z",
  }),
};

describe("Modul-Vertrag", () => {
  it("wartet erklärt, statt abzustürzen, wenn ein Pflicht-Eingang fehlt", () => {
    const result = runEvaluate(sumUnit, { ports: {} }, { factor: 2 });
    expect(result.status).toBe("idle");
    expect(result.output).toBeNull();
    expect(result.signal.explanation.cause).toContain("Datenquelle");
    expect(missingInputs(sumUnit as never, { ports: {} })).toHaveLength(1);
  });

  it("rechnet sofort und ohne Seiteneffekt", () => {
    const result = runEvaluate(sumUnit, { ports: { data: table } }, { factor: 2 });
    expect(result.status).toBe("ok");
    expect(result.output).toBe(2);
  });

  it("übernimmt den schlechteren Zustand der Eingänge", () => {
    const luecke = ingestText("Risiko;Eintritt\nHochwasser;\n", {
      sourceName: "luecke.csv",
      originKind: "file",
    });
    const result = runEvaluate(sumUnit, { ports: { data: luecke } }, { factor: 1 });
    expect(result.status).toBe("warn");
  });

  it("bereitet Wirkung nur vor und führt sie nie aus", () => {
    const result = runEvaluate(sumUnit, { ports: { data: table } }, { factor: 1 });
    const proposal = stageEffect(sumUnit, result, { factor: 1 });
    expect(proposal?.channel).toBe("email");
    expect(proposal?.payload).toEqual({ total: 1 });
    expect(effectCaution(proposal!)).toBe("Grundlage geprüft.");
  });

  it("warnt im Freigabe-Text bei lückenhafter oder verletzter Grundlage", () => {
    const base = {
      id: "e",
      unitId: "u",
      summary: "s",
      channel: "email",
      payload: {},
      rationale: "r",
      irreversible: false,
      preparedAt: "2026-01-01T00:00:00.000Z",
    };
    expect(effectCaution({ ...base, status: "warn" })).toContain("Lücken");
    expect(effectCaution({ ...base, status: "violation" })).toContain("Regelverstoß");
    expect(effectCaution({ ...base, status: "ok", irreversible: true })).toContain("Nicht umkehrbar");
  });

  it("gibt ohne prepareEffect nichts nach außen", () => {
    const { prepareEffect: _drop, ...rest } = sumUnit;
    const pure: UnitSpec<number, { factor: number }> = rest;
    const result = runEvaluate(pure, { ports: { data: table } }, { factor: 1 });
    expect(stageEffect(pure, result, { factor: 1 })).toBeNull();
  });
});
