import { readFileSync } from "fs";
import { describe, expect, it } from "vitest";
import { manifestToBackup, parseManifest } from "@/lib/runtime/manifest";
import { readApi } from "@/lib/api-module";
import { readPointSpec } from "@/lib/flow";

const text = readFileSync(new URL("../../../templates/foto-restaurants.scope.yaml", import.meta.url), "utf8");

describe("Bauplan Foto → Ort → Restaurants", () => {
  it("baut Scope, Verkabelung und App ohne Warnungen", () => {
    const { manifest, warnings } = parseManifest(text);
    expect(warnings).toEqual([]);
    const backup = manifestToBackup(manifest);
    expect(backup.nodes.map((n) => n["type"])).toEqual(["camera", "api", "map", "output"]);
    expect(backup.edges).toHaveLength(4);
    expect(backup.apps?.[0]?.["node_ids"]).toEqual(["kamera", "karte", "liste"]);
  });
  it("API-Schritt liest den Ort aus der Kamera und kennt seine Punkt-Zuordnung", () => {
    const api = manifestToBackup(parseManifest(text).manifest).nodes[1]!;
    const cfg = readApi({ metadata: api["metadata"] } as never);
    expect(cfg.url).toBe("https://overpass-api.de/api/interpreter");
    expect(cfg.params[0]?.value).toContain("{{input.lat}}");
    expect(readPointSpec((api["metadata"] as Record<string, unknown>)["points"])?.label).toBe("tags.name");
  });
});
