/**
 * Core module catalog.
 *
 * The approved building blocks a scope may be assembled from. Every entry is
 * a validated `*.scopem.yaml` file — no code is required to add a module, and
 * an assistant may only compose scopes from what is listed here.
 */
import cameraInput from "./camera-input.scopem.yaml?raw";
import interactiveMap from "./interactive-map.scopem.yaml?raw";
import osmNearbyPlaces from "./osm-nearby-places.scopem.yaml?raw";
import outputViewer from "./output-viewer.scopem.yaml?raw";
import supervisionZone from "./supervision-zone.scopem.yaml?raw";
import { parseScopeModule, type ScopeModuleSpec } from "@/lib/runtime/scopem";
import type { ModuleCatalog } from "@/lib/runtime/scope-spec";

const SOURCES: string[] = [
  cameraInput,
  osmNearbyPlaces,
  interactiveMap,
  outputViewer,
  supervisionZone,
];

let cached: ScopeModuleSpec[] | null = null;

/** All core modules, parsed and validated once. */
export function coreModules(): ScopeModuleSpec[] {
  if (!cached) cached = SOURCES.map((text) => parseScopeModule(text));
  return cached;
}

export function coreCatalog(): ModuleCatalog {
  return new Map(coreModules().map((module) => [module.metadata.name, module]));
}

/** Compact listing for the library UI and for the builder assistant. */
export function catalogSummary(): {
  name: string;
  version: string;
  title: string;
  description: string;
  category: string;
  tags: string[];
  nodeType: string;
  isContainer: boolean;
  inputs: { port: string; semantic: string; required: boolean; title: string }[];
  outputs: { port: string; semantic: string; title: string }[];
  requiresApproval: boolean;
}[] {
  return coreModules().map((module) => ({
    name: module.metadata.name,
    version: module.metadata.version,
    title: module.metadata.title,
    description: module.metadata.description,
    category: module.metadata.category,
    tags: module.metadata.tags,
    nodeType: module.metadata.nodeType,
    isContainer: Boolean(module.spec.container?.acceptsChildren),
    inputs: Object.entries(module.spec.inputs).map(([port, def]) => ({
      port,
      semantic: def.semantic,
      required: def.required,
      title: def.title,
    })),
    outputs: Object.entries(module.spec.outputs).map(([port, def]) => ({
      port,
      semantic: def.semantic,
      title: def.title,
    })),
    requiresApproval: module.spec.action.requiresApproval,
  }));
}
