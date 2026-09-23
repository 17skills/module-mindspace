import { describe, expect, it } from "vitest";
import { runEvaluate } from "@/lib/runtime/unit-spec";
import { decisionUnit, riskUnit, sourceUnit, unitForType } from "@/lib/runtime/units";
import { ingestText } from "@/lib/runtime/ingestion";

describe("Karten als Modul-Verträge", () => {
  it("Quelle ohne Inhalt wartet, statt zu stürzen", () => {
    const result = runEvaluate(sourceUnit(), { ports: {} }, { envelope: null, ontology: null });
    expect(result.status).toBe("idle");
    expect(result.output).toBeNull();
  });

  it("Quelle mit Tabelle liefert den Umschlag weiter", () => {
    const envelope = ingestText("Objekt;Eintritt\nPumpe;3", {
      sourceName: "test.csv",
      originKind: "text",
    });
    const result = runEvaluate(sourceUnit(), { ports: {} }, { envelope, ontology: null });
    expect(result.output).not.toBeNull();
    expect(["ok", "warn"]).toContain(result.status);
  });

  it("Risiko rechnet S = E × A und meldet Lücken", () => {
    const result = runEvaluate(
      riskUnit(),
      { ports: {} },
      {
        fields: [{ id: "a", code: "A1", name: "Hochwasser", note: "", chance: 5, impact: 5, auto: "none" }],
        gaps: ["Sturm: Eintritt fehlt"],
      },
    );
    expect(result.output?.highest).toBe(25);
    expect(result.status).toBe("violation");
    expect(result.notes).toHaveLength(1);
  });

  it("Entscheidung ohne Antwort bleibt grau", () => {
    const result = runEvaluate(
      decisionUnit(),
      { ports: {} },
      { questions: 2, answered: 0, review: 0, confidence: null },
    );
    expect(result.status).toBe("idle");
  });

  it("Entscheidung mit offener Prüfung warnt", () => {
    const result = runEvaluate(
      decisionUnit(),
      { ports: {} },
      { questions: 2, answered: 2, review: 1, confidence: 62 },
    );
    expect(result.status).toBe("warn");
    expect(result.signal.display).toBe("62 %");
  });

  it("Register kennt die echten Kartentypen", () => {
    for (const type of ["source", "risk", "decision", "action"]) {
      expect(unitForType(type)?.type).toBeTruthy();
    }
    expect(unitForType("note")).toBeNull();
  });
});
