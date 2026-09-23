import { describe, expect, it } from "vitest";
import { calibrate, certaintyOf, MIN_SAMPLES } from "@/lib/runtime/calibration";

describe("Kalibrierung", () => {
  it("sagt ohne Urteil nichts aus", () => {
    const result = calibrate([]);
    expect(result.status).toBe("idle");
    expect(result.confirmation).toBeNull();
  });

  it("wartet, bis genug Ausgänge vorliegen", () => {
    const result = calibrate([
      { confidence: 0.9, outcome: "released" },
      { confidence: 0.9, outcome: null },
    ]);
    expect(result.decided).toBe(1);
    expect(result.status).toBe("idle");
    expect(result.line).toContain("Rückmeldung");
  });

  it("nennt eine Karte kalibriert, wenn Sicherheit und Praxis zusammenpassen", () => {
    const points = Array.from({ length: 10 }, (_, index) => ({
      confidence: 0.9,
      outcome: (index < 9 ? "released" : "discarded") as "released" | "discarded",
    }));
    const result = calibrate(points);
    expect(result.status).toBe("ok");
    expect(result.confirmation).toBeCloseTo(0.9);
    expect(result.line).toBe("10 Einsätze · 90 % Bestätigung");
  });

  it("schlägt aus, wenn die Sicherheit systematisch zu hoch liegt", () => {
    const points = Array.from({ length: 5 }, () => ({
      confidence: 0.95,
      outcome: "discarded" as const,
    }));
    const result = calibrate(points);
    expect(result.status).toBe("violation");
    expect(result.note).toContain("gehen auseinander");
  });

  it("leitet fehlende Sicherheit aus der Wahrscheinlichkeit ab", () => {
    expect(certaintyOf({ confidence: null, probability: 0.88, outcome: null })).toBeCloseTo(0.76);
    expect(certaintyOf({ confidence: null, probability: 0.5, outcome: null })).toBe(0);
    expect(certaintyOf({ confidence: null, outcome: null })).toBeNull();
  });

  it("zählt Einsätze erst ab der Mindestzahl", () => {
    expect(MIN_SAMPLES).toBe(3);
  });
});
