import { describe, expect, it } from "vitest";
import { catalogSummary, coreCatalog, coreModules } from "@/lib/runtime/catalog";
import { parseScopeModule, portsCompatible, parseModuleRef, scopeModuleToYaml } from "@/lib/runtime/scopem";
import {
  parseScopeSpec,
  scopeSpecToManifest,
  validateScopeSpec,
} from "@/lib/runtime/scope-spec";

const SCOPE = `
apiVersion: scopebuilder.io/v1alpha1
kind: Scope
metadata:
  name: photo-to-restaurants
  version: 1.0.0
  title: Photo to Nearby Restaurants
  description: Capture a location, query nearby restaurants and show them on a map.
spec:
  ontology:
    name: Location-Based Services Standard
    depth: guarded
    rules:
      - id: privacy-gdpr-retention
        label: GDPR Location Data Retention
        subject: camera.outputs.location
        severity: warn
        rationale: Coordinates must not be kept longer than the purpose requires.
        reference: GDPR Art. 5(1)(e)
  modules:
    - id: stage
      ref: catalog:core/supervision-zone@1.0.0
    - id: camera
      ref: catalog:core/camera-input@1.0.0
      parent: stage
    - id: finder
      ref: catalog:core/osm-nearby-places@1.0.0
      parent: stage
      overrides:
        inputs:
          radius: 1200
    - id: map
      ref: catalog:core/interactive-map@1.0.0
    - id: result
      ref: catalog:core/output-viewer@1.0.0
  bindings:
    - from: camera.outputs.location
      to: finder.inputs.location
    - from: finder.outputs.places
      to: map.inputs.markers
    - from: finder.outputs.places
      to: result.inputs.items
  apps:
    - name: restaurant-radar
      title: Restaurant Radar
      channel: mobile
      access: public
      modules: [camera, map, result]
layout:
  canvas:
    stage: { x: 40, y: 40 }
    camera: { x: 120, y: 140 }
    finder: { x: 460, y: 140 }
    map: { x: 820, y: 80 }
    result: { x: 820, y: 320 }
`;

describe("module catalog", () => {
  it("parses every core module", () => {
    expect(coreModules().length).toBe(5);
    for (const module of coreModules()) {
      expect(module.metadata.title.length).toBeGreaterThan(0);
      expect(module.metadata.description.length).toBeGreaterThan(0);
    }
  });

  it("marks the supervision zone as a container that accepts children", () => {
    const zone = coreCatalog().get("supervision-zone");
    expect(zone?.spec.container?.acceptsChildren).toBe(true);
    expect(zone?.spec.engine.type).toBe("agent");
    expect(zone?.spec.engine.governance?.maxSteps).toBe(5);
  });

  it("exposes a summary for the library and the assistant", () => {
    const summary = catalogSummary();
    const finder = summary.find((entry) => entry.name === "osm-nearby-places");
    expect(finder?.inputs.some((port) => port.port === "location" && port.required)).toBe(true);
    expect(finder?.outputs.some((port) => port.semantic === "geo:features")).toBe(true);
  });

  it("round-trips a module through YAML", () => {
    const zone = coreCatalog().get("supervision-zone")!;
    const again = parseScopeModule(scopeModuleToYaml(zone));
    expect(again.metadata.name).toBe("supervision-zone");
  });

  it("forces approval when a module has side effects", () => {
    const text = `
apiVersion: scopebuilder.io/v1alpha1
kind: ScopeModule
metadata:
  name: call-restaurant
  version: 1.0.0
  title: Phone Agent
  description: Calls a restaurant to request a table.
  category: action
  nodeType: action
spec:
  action:
    hasSideEffects: true
`;
    expect(parseScopeModule(text).spec.action.requiresApproval).toBe(true);
  });

  it("reads catalog references", () => {
    expect(parseModuleRef("catalog:core/camera-input@1.0.0")).toEqual({
      name: "camera-input",
      version: "1.0.0",
    });
    expect(parseModuleRef("camera-input")).toEqual({ name: "camera-input", version: null });
  });
});

describe("port compatibility", () => {
  const port = (semantic: string) =>
    ({ semantic, title: "", description: "", required: false, unit: null, schema: {}, extractPath: null, mapping: {} }) as never;

  it("accepts matching semantics and rejects mismatches", () => {
    expect(portsCompatible(port("geo:point"), port("geo:point"))).toBe(true);
    expect(portsCompatible(port("geo:features"), port("data:list"))).toBe(true);
    expect(portsCompatible(port("media:image"), port("primitive:json"))).toBe(true);
    expect(portsCompatible(port("media:image"), port("geo:point"))).toBe(false);
  });
});

describe("scope spec", () => {
  it("validates a scope built from catalog modules", () => {
    const spec = parseScopeSpec(SCOPE);
    const report = validateScopeSpec(spec, coreCatalog());
    expect(report.errors).toEqual([]);
  });

  it("reports unknown modules, bad parents and incompatible ports", () => {
    const broken = parseScopeSpec(`
apiVersion: scopebuilder.io/v1alpha1
kind: Scope
metadata:
  name: broken
  version: 1.0.0
  title: Broken
spec:
  modules:
    - id: ghost
      ref: catalog:core/does-not-exist@1.0.0
    - id: camera
      ref: catalog:core/camera-input@1.0.0
    - id: child
      ref: catalog:core/output-viewer@1.0.0
      parent: camera
  bindings:
    - from: camera.outputs.photo
      to: child.inputs.items
`);
    const report = validateScopeSpec(broken, coreCatalog());
    expect(report.errors.some((e) => e.includes("does-not-exist"))).toBe(true);
    expect(report.errors.some((e) => e.includes("abgelegt"))).toBe(true);
    expect(report.errors.some((e) => e.includes("passt nicht"))).toBe(true);
  });

  it("converts to the existing scope manifest with parents, layout and engines", () => {
    const manifest = scopeSpecToManifest(parseScopeSpec(SCOPE), coreCatalog());
    expect(manifest.scopebuilder).toBe("scopebuilder/v1");
    expect(manifest.modules).toHaveLength(5);

    const camera = manifest.modules.find((m) => m.id === "camera")!;
    expect(camera.type).toBe("camera");
    expect(camera.parent).toBe("stage");
    expect(camera.at).toEqual([120, 140]);

    const finder = manifest.modules.find((m) => m.id === "finder")!;
    expect(finder.type).toBe("api");
    expect(finder.settings["radius"]).toBe(1200);
    expect(finder.settings["url"]).toBe("https://overpass-api.de/api/interpreter");
    expect(finder.settings["moduleRef"]).toBe("osm-nearby-places@1.0.0");

    const stage = manifest.modules.find((m) => m.id === "stage")!;
    expect(stage.type).toBe("zone");
    expect(stage.size?.[0]).toBe(900);

    expect(manifest.links).toHaveLength(3);
    expect(manifest.apps[0]?.channels).toEqual(["mobile"]);
  });

  it("keeps secrets out of the module files", () => {
    for (const module of coreModules()) {
      const yaml = scopeModuleToYaml(module).toLowerCase();
      expect(/api[_-]?key:\s*\S/.test(yaml)).toBe(false);
      expect(/password:\s*\S/.test(yaml)).toBe(false);
    }
  });
});
