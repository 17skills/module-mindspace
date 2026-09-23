import { describe, expect, it } from "vitest";
import { coalesce, type QueuedOp } from "@/lib/board-offline";

function op(extra: Partial<QueuedOp> & Pick<QueuedOp, "kind">): QueuedOp {
  return { opId: crypto.randomUUID(), at: Date.now(), boardId: "b1", ...extra } as QueuedOp;
}

describe("coalesce", () => {
  it("fasst mehrere Änderungen am selben Modul zusammen", () => {
    const first = op({ kind: "node.update", id: "n1", patch: { position_x: 1, title: "A" } });
    const second = op({ kind: "node.update", id: "n1", patch: { position_x: 9 } });
    const list = coalesce([first], second);
    expect(list).toHaveLength(1);
    expect((list[0] as { patch: Record<string, unknown> }).patch).toEqual({
      position_x: 9,
      title: "A",
    });
  });

  it("hält Änderungen an verschiedenen Modulen getrennt", () => {
    const first = op({ kind: "node.update", id: "n1", patch: { title: "A" } });
    const second = op({ kind: "node.update", id: "n2", patch: { title: "B" } });
    expect(coalesce([first], second)).toHaveLength(2);
  });

  it("hängt Löschungen immer hinten an", () => {
    const first = op({ kind: "node.update", id: "n1", patch: { title: "A" } });
    const second = op({ kind: "node.delete", ids: ["n1"] });
    const list = coalesce([first], second);
    expect(list).toHaveLength(2);
    expect(list[1]!.kind).toBe("node.delete");
  });
});
