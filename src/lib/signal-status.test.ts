import { describe, expect, it } from "vitest";
import type { Edge } from "@xyflow/react";
import { makeNode } from "@/test/nodes";
import { sourceStatus, targetStatus } from "@/lib/signal-status";
import { valueOfNode } from "@/lib/calc";
import type { NodeRecord } from "@/components/canvas/board-context";

function graph(nodes: NodeRecord[]) {
  const records: Record<string, NodeRecord> = {};
  for (const node of nodes) records[node.id] = node;
  return records;
}

const edge = (id: string, source: string, target: string, label?: string): Edge => ({
  id,
  source,
  target,
  ...(label ? { label } : {}),
});

describe("Signalzustände an den Verbindungspunkten", () => {
  it("grün: Rechner liefert seinen berechneten Wert am Ausgang", () => {
    const a = makeNode("metric", "Kosten", { id: "a", metadata: { value: 1000 } });
    const calc = makeNode("calc", "Summe", { id: "calc", metadata: { formula: "A * 2" } });
    const out = makeNode("metric", "Ergebnis", { id: "out" });
    const records = graph([a, calc, out]);
    const edges = [edge("e1", "a", "calc"), edge("e2", "calc", "out")];

    expect(valueOfNode(calc, records, edges)).toBe(2000);
    expect(sourceStatus("calc", records, edges)).toBe("ok");
    expect(targetStatus("out", records, edges)).toBe("ok");
  });

  it("grün: Prozentangabe an der Verbindung kommt am Eingang an", () => {
    const a = makeNode("metric", "Budget", { id: "a", metadata: { value: 800 } });
    const b = makeNode("metric", "Anteil", { id: "b" });
    const records = graph([a, b]);
    const edges = [edge("e1", "a", "b", "25 %")];

    expect(targetStatus("b", records, edges)).toBe("ok");
  });

  it("bernstein: Zahlenmodul ohne Wert wartet noch", () => {
    const a = makeNode("metric", "Noch leer", { id: "a", metadata: {} });
    const b = makeNode("calc", "Rechnung", { id: "b", metadata: { formula: "A + 1" } });
    const records = graph([a, b]);
    const edges = [edge("e1", "a", "b")];

    expect(sourceStatus("a", records, edges)).toBe("warn");
    expect(targetStatus("b", records, edges)).toBe("warn");
  });

  it("rot: ungültige Rechnung an der Verbindung", () => {
    const a = makeNode("metric", "Kosten", { id: "a", metadata: { value: 500 } });
    const b = makeNode("calc", "Rechnung", { id: "b" });
    const records = graph([a, b]);
    const edges = [edge("e1", "a", "b", "x / 0")];

    expect(targetStatus("b", records, edges)).toBe("error");
  });

  it("neutral: reine Inhaltsverbindung bleibt grau", () => {
    const doc = makeNode("document", "Leitfaden", { id: "doc" });
    const chat = makeNode("chat", "Chat", { id: "chat" });
    const records = graph([doc, chat]);
    const edges = [edge("e1", "doc", "chat")];

    expect(sourceStatus("doc", records, edges)).toBe("idle");
    expect(targetStatus("chat", records, edges)).toBe("idle");
  });

  it("neutral: ohne Verbindung leuchtet nichts", () => {
    const a = makeNode("metric", "Allein", { id: "a", metadata: { value: 5 } });
    const records = graph([a]);

    expect(sourceStatus("a", records, [])).toBe("idle");
    expect(targetStatus("a", records, [])).toBe("idle");
  });
});
