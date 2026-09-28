/**
 * Place a catalog building block on the canvas.
 *
 * Runs through the same path as a blueprint (`scopeSpecToManifest`), so a
 * module placed by hand and one built from a `.scope.yaml` carry identical
 * settings: presets, engine, constraints, approval duty, limits and the
 * `moduleRef` (name@version) that ties the card to its building block.
 */
import { coreCatalog } from "@/lib/runtime/catalog";
import { SCOPE_API_VERSION, SCOPE_KIND, ScopeSpecSchema, scopeSpecToManifest } from "@/lib/runtime/scope-spec";
import { sanitizeSettings } from "@/lib/runtime/manifest";
import type { LibraryPayload } from "@/lib/library";

export function catalogModulePayload(name: string): LibraryPayload {
  const catalog = coreCatalog();
  const module = catalog.get(name);
  if (!module) throw new Error(`Baustein „${name}“ ist nicht im Katalog`);
  const spec = ScopeSpecSchema.parse({
    apiVersion: SCOPE_API_VERSION,
    kind: SCOPE_KIND,
    metadata: { name: "baustein", version: "1.0.0", title: module.metadata.title },
    spec: { modules: [{ id: "m", ref: `catalog:core/${name}@${module.metadata.version}` }] },
  });
  const placed = scopeSpecToManifest(spec, catalog).modules[0]!;
  const w = placed.size?.[0] ?? 320;
  const h = placed.size?.[1] ?? 220;
  return {
    version: 1,
    nodes: [
      {
        localId: "m",
        parentLocalId: null,
        type: placed.type,
        title: placed.title ?? module.metadata.title,
        x: 0,
        y: 0,
        w,
        h,
        color: null,
        content: "",
        sourceUrl: placed.url ?? null,
        metadata: sanitizeSettings(placed.settings),
      },
    ],
    edges: [],
    bounds: { width: w, height: h },
  };
}

/** name → current version, for "outdated building block" notices. */
export function catalogVersions(): Map<string, string> {
  return new Map([...coreCatalog().values()].map((m) => [m.metadata.name, m.metadata.version]));
}
