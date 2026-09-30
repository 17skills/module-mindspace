import { describe, expect, it } from "vitest";
import { evaluateTrigger, parseConditions, readPath, toNumber } from "@/lib/trigger-conditions";

describe("readPath", () => {
  it("liest verschachtelte Felder und Listenplätze", () => {
    const data = { current: { wind: [{ speed: 82 }] } };
    expect(readPath(data, "current.wind.0.speed")).toBe(82);
    expect(readPath(data, "current.fehlt")).toBeUndefined();
  });
});

describe("toNumber", () => {
  it("erkennt Zahlen in Text", () => {
    expect(toNumber("82 km/h")).toBe(82);
    expect(toNumber("1.234,5")).toBe(1234.5);
    expect(toNumber("keine")).toBeNull();
  });
});

describe("evaluateTrigger", () => {
  const payload = { wind: 82, status: "CRITICAL alarm", price: 110 };

  it("startet ohne Bedingung", () => {
    expect(evaluateTrigger([], payload).fired).toBe(true);
  });

  it("prüft Zahlengrenzen", () => {
    expect(evaluateTrigger([{ path: "wind", op: "gt", value: 75 }], payload).fired).toBe(true);
    expect(evaluateTrigger([{ path: "wind", op: "gt", value: 90 }], payload).fired).toBe(false);
  });

  it("prüft Text", () => {
    expect(evaluateTrigger([{ path: "status", op: "contains", value: "critical" }], payload).fired).toBe(true);
    expect(evaluateTrigger([{ path: "status", op: "contains", value: "ok" }], payload).fired).toBe(false);
  });

  it("erkennt Änderungen gegenüber dem letzten Lauf", () => {
    const rule = [{ path: "wind", op: "changed" as const }];
    expect(evaluateTrigger(rule, payload, { wind: 82 }).fired).toBe(false);
    expect(evaluateTrigger(rule, payload, { wind: 40 }).fired).toBe(true);
  });

  it("rechnet absolute und prozentuale Abweichung", () => {
    expect(evaluateTrigger([{ path: "price", op: "delta_abs", value: 5 }], payload, { price: 100 }).fired).toBe(true);
    expect(evaluateTrigger([{ path: "price", op: "delta_pct", value: 20 }], payload, { price: 100 }).fired).toBe(false);
    expect(evaluateTrigger([{ path: "price", op: "delta_pct", value: 5 }], payload, { price: 100 }).fired).toBe(true);
  });

  it("wartet beim ersten Lauf auf einen Vergleichswert", () => {
    const out = evaluateTrigger([{ path: "price", op: "delta_pct", value: 5 }], payload, {});
    expect(out.fired).toBe(false);
    expect(out.results[0]?.reason).toContain("Vergleichswert");
  });

  it("unterscheidet eine und alle Bedingungen", () => {
    const rules = [
      { path: "wind", op: "gt" as const, value: 75 },
      { path: "price", op: "gt" as const, value: 500 },
    ];
    expect(evaluateTrigger(rules, payload, {}, "any").fired).toBe(true);
    expect(evaluateTrigger(rules, payload, {}, "all").fired).toBe(false);
  });

  it("merkt die neuen Werte für den nächsten Vergleich", () => {
    const out = evaluateTrigger([{ path: "wind", op: "changed" }], payload, { wind: 10 });
    expect(out.nextValues["wind"]).toBe(82);
  });
});

describe("parseConditions", () => {
  it("wirft unbekannte Regeln weg", () => {
    const parsed = parseConditions([
      { path: "a", op: "gt", value: 1 },
      { path: "", op: "gt" },
      { path: "b", op: "hack" },
    ]);
    expect(parsed).toEqual([{ path: "a", op: "gt", value: 1 }]);
  });
});
