import { describe, expect, it } from "vitest";
import { guestView, stripSecrets } from "./guest-view";

describe("Gastansicht", () => {
  it("entfernt Zugangsdaten auf jeder Ebene", () => {
    const out = stripSecrets({
      url: "https://api.x",
      headers: [{ key: "Authorization", value: "Bearer abc" }],
      nested: { apiKey: "k", keep: 1, list: [{ token: "t", ok: true }] },
      journal: { a: "id" },
    }) as Record<string, unknown>;
    expect(out).toEqual({ url: "https://api.x", nested: { keep: 1, list: [{ ok: true }] } });
  });

  it("verbirgt Module mit eigener Regel samt Inhalt im Rahmen und deren Verbindungen", () => {
    const nodes = [
      { id: "a", parent_id: null, user_id: "u1", storage_path: "u1/x.pdf", metadata: {} },
      { id: "geheim", parent_id: null, user_id: "u1", metadata: {} },
      { id: "kind", parent_id: "geheim", user_id: "u1", metadata: {} },
    ];
    const edges = [
      { id: "e1", source_id: "a", target_id: "geheim", user_id: "u1" },
      { id: "e2", source_id: "a", target_id: "a", user_id: "u1" },
    ];
    const view = guestView(nodes, edges, new Set(["geheim"]));
    expect(view.nodes.map((n) => n["id"])).toEqual(["a"]);
    expect(view.nodes[0]!["user_id"]).toBe("");
    expect(view.nodes[0]!["storage_path"]).toBeNull();
    expect(view.edges.map((e) => e["id"])).toEqual(["e2"]);

    const leak = guestView(
      [
        { id: "geheim", parent_id: null, metadata: {} },
        { id: "aus", parent_id: null, metadata: { output: { sourceId: "geheim", text: "vertraulich" } } },
      ],
      [],
      new Set(["geheim"]),
    );
    expect((leak.nodes[0]!["metadata"] as Record<string, unknown>)["output"]).toBeUndefined();
  });
});
