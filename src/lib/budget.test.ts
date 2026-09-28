import { describe, expect, it } from "vitest";
import { BudgetMeter, DEFAULT_BUDGET, checkInputBudget, readBudget } from "@/lib/budget";

describe("Budgetbremse", () => {
  it("nimmt das Budget des Bausteins", () => {
    const budget = readBudget({ governance: { maxSteps: 3, maxTokenBudget: 500, timeoutSeconds: 20 } });
    expect(budget).toEqual({ maxSteps: 3, maxTokenBudget: 500, timeoutSeconds: 20 });
  });

  it("fällt ohne Deklaration auf den Standarddeckel zurück", () => {
    expect(readBudget({})).toEqual(DEFAULT_BUDGET);
    expect(readBudget(null)).toEqual(DEFAULT_BUDGET);
  });

  it("überschreitet nie die harte Obergrenze", () => {
    expect(readBudget({ governance: { maxTokenBudget: 9_000_000 } }).maxTokenBudget).toBe(200_000);
  });

  it("lehnt eine zu große Eingabe vor dem Aufruf ab", () => {
    const check = checkInputBudget("x".repeat(8_000), { ...DEFAULT_BUDGET, maxTokenBudget: 100 });
    expect(check.ok).toBe(false);
  });

  it("bricht ab, sobald die Ausgabe das Budget erreicht", () => {
    const meter = new BudgetMeter({ ...DEFAULT_BUDGET, maxTokenBudget: 50 }, 10);
    expect(meter.add("kurz")).toBe(false);
    expect(meter.add("y".repeat(1_000))).toBe(true);
    expect(meter.exceeded).toBe(true);
    expect(meter.costUsd).toBeGreaterThan(0);
  });
});
