import { describe, expect, it } from "vitest";
import { runEvaluate, stageEffect } from "@/lib/runtime/unit-spec";
import {
  actionUnit,
  basisStatus,
  discardEffect,
  needsJustification,
  readAction,
  releaseEffect,
  stagingBrief,
  toStaged,
  type ActionState,
} from "@/lib/runtime/staging";

const spec = actionUnit();

function state(over: Partial<ActionState["config"]> = {}, status: "ok" | "warn" | "violation" = "ok"): ActionState {
  return {
    config: { channel: "email", summary: "Betriebsleitung informieren", recipient: "leitung@werk.de", message: "", ...over },
    basis: [{ unitId: "n1", title: "budget.csv", brief: "Budgetgrenze verletzt", status }],
  };
}

describe("Ablagefach", () => {
  it("wartet erklärt, solange die Wirkung nicht beschrieben ist", () => {
    const result = runEvaluate(spec, { ports: {} }, { config: { channel: "email", summary: "", recipient: "", message: "" }, basis: [] });
    expect(result.status).toBe("idle");
    expect(result.output).toBeNull();
    expect(result.signal.explanation.cause).toContain("Es fehlt");
  });

  it("übernimmt den schlechtesten Zustand der Grundlage", () => {
    expect(basisStatus([{ unitId: "a", title: "a", brief: "", status: "ok" }, { unitId: "b", title: "b", brief: "", status: "violation" }])).toBe("violation");
    const result = runEvaluate(spec, { ports: {} }, state({}, "violation"));
    expect(result.status).toBe("violation");
  });

  it("bereitet nur einen Vorschlag vor und führt nichts aus", () => {
    const result = runEvaluate(spec, { ports: {} }, state());
    const proposal = stageEffect(spec, result, state());
    expect(proposal).not.toBeNull();
    const staged = toStaged(proposal!);
    expect(staged.state).toBe("staged");
    expect(staged.payload["recipient"]).toBe("leitung@werk.de");
  });

  it("verlangt Begründung bei Regelverstoß oder unumkehrbarer Wirkung", () => {
    const result = runEvaluate(spec, { ports: {} }, state({}, "violation"));
    const staged = toStaged(stageEffect(spec, result, state({}, "violation"))!);
    expect(needsJustification(staged)).toBe(true);
    expect(staged.caution).toContain("Nicht umkehrbar");
  });

  it("protokolliert Freigabe und Verwerfen mit Person", () => {
    const result = runEvaluate(spec, { ports: {} }, state());
    const staged = toStaged(stageEffect(spec, result, state())!);
    const released = releaseEffect(staged, "Niels", "geprüft");
    expect(released.state).toBe("released");
    expect(released.decidedBy).toBe("Niels");
    expect(discardEffect(staged, "Niels").state).toBe("discarded");
    expect(stagingBrief({ config: state().config, effects: [released] })).toContain("freigegeben von Niels");
  });

  it("liest einen leeren Stand ohne Absturz", () => {
    expect(readAction(null).effects).toEqual([]);
    expect(readAction({ action: { config: { channel: "report" } } }).config.channel).toBe("report");
  });
});
