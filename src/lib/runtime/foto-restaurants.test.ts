import { readFileSync } from "fs";
import { it, expect } from "vitest";
import { parseManifest, manifestToBackup } from "@/lib/runtime/manifest";
it("bauplan", () => {
  const { manifest, warnings } = parseManifest(readFileSync("templates/foto-restaurants.scope.yaml", "utf8"));
  console.log(warnings, JSON.stringify(manifestToBackup(manifest).nodes[1]).slice(0, 400), JSON.stringify(manifestToBackup(manifest).apps));
  expect(manifest.modules.length).toBe(4);
});
