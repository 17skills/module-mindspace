import { describe, expect, it } from "vitest";
import { artifactFrom, kindOf, readOutput, safeUrl, sameArtifact } from "./output";
import type { NodeRecord } from "@/components/canvas/board-context";

const base: NodeRecord = {
  id: "n1", board_id: "b", user_id: "u", parent_id: null, type: "document", title: "Plan",
  position_x: 0, position_y: 0, width: null, height: null, color: null, source_url: null,
  storage_path: null, mime_type: null, content: null, status: null, error: null, metadata: null,
};

describe("Ergebnis-Modul", () => {
  it("erkennt Artefaktarten", () => {
    expect(kindOf("image/png", "", false)).toBe("image");
    expect(kindOf(null, "u/x.pdf", false)).toBe("pdf");
    expect(kindOf(null, "u/model.glb", false)).toBe("model3d");
    expect(kindOf(null, "u/deck.pptx", false)).toBe("slides");
    expect(kindOf(null, "", true)).toBe("text");
    expect(kindOf(null, "", false)).toBe("empty");
  });

  it("lässt nur https-Adressen durch", () => {
    expect(safeUrl("javascript:alert(1)")).toBeNull();
    expect(safeUrl("http://x.de/a.png")).toBeNull();
    expect(safeUrl("https://x.de/a.png")).toBe("https://x.de/a.png");
  });

  it("macht aus einer Karte ein Artefakt und liest es robust zurück", () => {
    const a = artifactFrom({ ...base, storage_path: "u/n1-bild.jpg", mime_type: "image/jpeg" });
    expect(a.kind).toBe("image");
    expect(a.hasFile).toBe(true);
    const back = readOutput({ output: a });
    expect(sameArtifact(a, back)).toBe(true);
    expect(readOutput({ output: { kind: "evil", url: "javascript:x" } }).kind).toBe("empty");
    expect(readOutput({ output: { kind: "link", url: "javascript:x" } }).url).toBeNull();
  });

  it("ohne Karte bleibt der Ausgang leer", () => {
    expect(artifactFrom(null).kind).toBe("empty");
  });
});
