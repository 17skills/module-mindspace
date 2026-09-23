import { describe, expect, it } from "vitest";
import { mergeRemoteNode } from "@/lib/board-conflict";
import type { NodeRecord } from "@/components/canvas/board-context";

const base: NodeRecord = {
  id: "n1",
  board_id: "b1",
  user_id: "u1",
  parent_id: null,
  type: "text",
  title: "Alt",
  position_x: 0,
  position_y: 0,
  width: 320,
  height: 200,
  color: null,
  source_url: null,
  storage_path: null,
  mime_type: null,
  content: "Mein Text",
  status: "ready",
  error: null,
  metadata: {},
};

describe("mergeRemoteNode", () => {
  it("übernimmt fremde Änderungen an unberührten Feldern", () => {
    const local = { ...base, content: "Mein Text" };
    const remote = { ...base, position_x: 500, title: "Neu" };
    const result = mergeRemoteNode(local, remote, () => false);
    expect(result.merged.position_x).toBe(500);
    expect(result.merged.title).toBe("Neu");
    expect(result.conflicts).toHaveLength(0);
  });

  it("behält das eigene Feld und meldet den Konflikt", () => {
    const local = { ...base, content: "Meine Fassung" };
    const remote = { ...base, content: "Fremde Fassung", position_x: 42 };
    const result = mergeRemoteNode(local, remote, (field) => field === "content");
    expect(result.merged.content).toBe("Meine Fassung");
    expect(result.merged.position_x).toBe(42);
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0]).toMatchObject({ field: "content", theirs: "Fremde Fassung" });
  });

  it("vergleicht Einstellungen inhaltlich", () => {
    const local = { ...base, metadata: { a: 1 } };
    const remote = { ...base, metadata: { a: 1 } };
    const result = mergeRemoteNode(local, remote, () => true);
    expect(result.conflicts).toHaveLength(0);
  });

  it("nimmt neue Module unverändert an", () => {
    const result = mergeRemoteNode(undefined, base, () => true);
    expect(result.merged).toBe(base);
  });
});
