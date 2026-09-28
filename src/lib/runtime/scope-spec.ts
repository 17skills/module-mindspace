/**
 * Scope manifest (`scopebuilder.io/v1alpha1`, kind `Scope`).
 *
 * A whole process as a readable file (`*.scope` / `*.scope.yaml`): which
 * modules take part, how their ports are wired, which rules and compliance
 * guard rails apply, and which focused apps project the process to end users.
 *
 * Invariants:
 *  - `spec` stays purely logical, so a scope also runs headless (agent, MCP, cron)
 *  - canvas coordinates live in the optional `layout` block
 *  - modules are referenced from the catalog (`ref`) or declared inline
 *  - bindings are typed; incompatible ports are reported, never silently wired
 */
import { parse as parseYamlText, stringify } from "yaml";
import { z } from "zod";
import {
  MANIFEST_VERSION,
  type ScopeManifest,
  roleOf,
} from "@/lib/runtime/manifest";
import {
  ScopeModuleSchema,
  type ScopeModuleSpec,
  parseModuleRef,
  portsCompatible,
} from "@/lib/runtime/scopem";

export const SCOPE_API_VERSION = "scopebuilder.io/v1alpha1";
export const SCOPE_KIND = "Scope";

const DNS_NAME = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;
const SEMVER = /^\d+\.\d+\.\d+$/;

const RuleSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  subject: z.string().default(""),
  operator: z
    .enum(["lte", "gte", "lt", "gt", "eq", "neq", "between", "oneOf", "required"])
    .nullable()
    .default(null),
  value: z
    .union([z.number(), z.string(), z.boolean(), z.array(z.union([z.number(), z.string()]))])
    .nullable()
    .default(null),
  unit: z.string().nullable().default(null),
  severity: z.enum(["info", "warn", "violation"]).default("warn"),
  rationale: z.string().default(""),
  reference: z.string().nullable().default(null),
  requires: z.string().nullable().default(null),
});

const ScopeOntologySchema = z.object({
  name: z.string().default(""),
  depth: z.enum(["advisory", "guarded", "strict"]).default("advisory"),
  rules: z.array(RuleSchema).max(500).default([]),
});

const InstanceSchema = z.object({
  id: z.string().min(1),
  /** Catalog reference, e.g. `catalog:core/camera-input@1.0.0`. */
  ref: z.string().min(1).nullable().default(null),
  /** Inline module definition when nothing in the catalog fits. */
  module: ScopeModuleSchema.optional(),
  title: z.string().nullable().default(null),
  /** Id of the container module (background zone) this module sits on. */
  parent: z.string().nullable().default(null),
  config: z.record(z.string(), z.unknown()).default({}),
  overrides: z
    .object({ inputs: z.record(z.string(), z.unknown()).default({}) })
    .default({ inputs: {} }),
});
export type ScopeModuleInstance = z.infer<typeof InstanceSchema>;

const BindingSchema = z.object({
  /** `moduleId.outputs.portName` */
  from: z.string().min(1),
  /** `moduleId.inputs.portName` */
  to: z.string().min(1),
  label: z.string().nullable().default(null),
  /** Port field → dataset column, e.g. `{ lat: "Breite" }`. */
  mapping: z.record(z.string(), z.string()).default({}),
});

/** Named data source — only a reference; the scope never carries rows. */
const DatasetSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/, "Dataset id must be lowercase letters, digits and dashes"),
  title: z.string().default(""),
  kind: z.enum(["upload", "api", "verified"]).default("upload"),
  /** Column name → type (string | number | boolean | date). */
  schema: z.record(z.string(), z.enum(["string", "number", "boolean", "date"])).default({}),
  verified: z.boolean().default(false),
  sourceUrl: z.string().url().startsWith("https://").nullable().default(null),
  retention: z.string().nullable().default(null),
});
export type ScopeDataset = z.infer<typeof DatasetSchema>;

const AppSchema = z.object({
  name: z.string().min(1),
  title: z.string().default(""),
  description: z.string().default(""),
  channel: z.enum(["web", "mobile", "teams", "mcp"]).default("web"),
  access: z.enum(["public", "org", "restricted"]).default("restricted"),
  modules: z.array(z.string()).max(200).default([]),
  branding: z.record(z.string(), z.unknown()).default({}),
});

const LayoutSchema = z.object({
  canvas: z
    .record(
      z.string(),
      z.object({
        x: z.number().default(0),
        y: z.number().default(0),
        width: z.number().nullable().default(null),
        height: z.number().nullable().default(null),
        color: z.string().nullable().default(null),
        collapsed: z.boolean().default(false),
      }),
    )
    .default({}),
});

export const ScopeSpecSchema = z.object({
  apiVersion: z.literal(SCOPE_API_VERSION),
  kind: z.literal(SCOPE_KIND),
  metadata: z.object({
    name: z.string().regex(DNS_NAME, "Name must be lowercase letters, digits and dashes"),
    version: z.string().regex(SEMVER, "Version must be semantic, e.g. 1.0.0"),
    title: z.string().min(1),
    description: z.string().default(""),
    tags: z.array(z.string()).max(20).default([]),
    author: z.string().default(""),
    license: z.string().default(""),
  }),
  spec: z.object({
    ontology: ScopeOntologySchema.default({ name: "", depth: "advisory", rules: [] }),
    datasets: z.array(DatasetSchema).max(200).default([]),
    modules: z.array(InstanceSchema).max(2000).default([]),
    bindings: z.array(BindingSchema).max(4000).default([]),
    apps: z.array(AppSchema).max(50).default([]),
  }),
  layout: LayoutSchema.default({ canvas: {} }),
});
export type ScopeSpec = z.infer<typeof ScopeSpecSchema>;

/** Catalog lookup: module name → definition. */
export type ModuleCatalog = Map<string, ScopeModuleSpec>;

export function isScopeSpecText(text: string): boolean {
  return /kind:\s*["']?Scope["']?\s*$/m.test(text.slice(0, 2000));
}

export function parseScopeSpec(text: string): ScopeSpec {
  const front = /^\s*---\s*\n([\s\S]*?)\n---\s*(?:\n|$)/.exec(text);
  const yamlPart = front ? (front[1] ?? "") : text;
  let raw: unknown;
  try {
    raw = parseYamlText(yamlPart);
  } catch (error) {
    throw new Error(`Die Datei ist kein lesbares YAML: ${error instanceof Error ? error.message : ""}`);
  }
  const result = ScopeSpecSchema.safeParse(raw);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new Error(
      `Kein gültiger Scope (${issue?.path.join(".") || "Kopf"}: ${issue?.message ?? "unbekannt"})`,
    );
  }
  return result.data;
}

/** Resolve an instance to its module definition (inline wins over catalog). */
export function resolveModule(
  instance: ScopeModuleInstance,
  catalog: ModuleCatalog,
): ScopeModuleSpec | null {
  if (instance.module) return instance.module;
  if (!instance.ref) return null;
  const { name } = parseModuleRef(instance.ref);
  return catalog.get(name) ?? null;
}

function splitPort(path: string): { id: string; side: "inputs" | "outputs"; port: string } | null {
  const parts = path.split(".");
  if (parts.length === 3 && (parts[1] === "inputs" || parts[1] === "outputs")) {
    return { id: parts[0]!, side: parts[1] as "inputs" | "outputs", port: parts[2]! };
  }
  if (parts.length === 2) return { id: parts[0]!, side: "outputs", port: parts[1]! };
  return null;
}

export type ScopeValidation = { errors: string[]; warnings: string[] };

/** Check references, parents and port compatibility before anything is built. */
export function validateScopeSpec(spec: ScopeSpec, catalog: ModuleCatalog): ScopeValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  const resolved = new Map<string, ScopeModuleSpec>();
  const seen = new Set<string>();

  for (const instance of spec.spec.modules) {
    if (seen.has(instance.id)) {
      errors.push(`Modul „${instance.id}" kommt doppelt vor.`);
      continue;
    }
    seen.add(instance.id);
    const module = resolveModule(instance, catalog);
    if (!module) {
      errors.push(`Baustein „${instance.ref ?? instance.id}" ist nicht in der Bibliothek.`);
      continue;
    }
    resolved.set(instance.id, module);
  }

  for (const instance of spec.spec.modules) {
    if (!instance.parent) continue;
    if (!seen.has(instance.parent)) {
      errors.push(`Modul „${instance.id}" liegt auf unbekanntem Hintergrund „${instance.parent}".`);
      continue;
    }
    const parent = resolved.get(instance.parent);
    if (parent && !parent.spec.container?.acceptsChildren) {
      errors.push(`Auf „${instance.parent}" können keine Module abgelegt werden.`);
    }
  }

  const datasets = new Map(spec.spec.datasets.map((d) => [d.id, d]));
  for (const dataset of spec.spec.datasets) {
    if (dataset.kind === "verified" && !dataset.sourceUrl) {
      warnings.push(`Datenquelle „${dataset.id}" ist als geprüft markiert, hat aber keine Adresse.`);
    }
  }
  for (const rule of spec.spec.ontology.rules) {
    const col = /^datasets\.([^.]+)\.columns\.(.+)$/.exec(rule.subject);
    if (!col) continue;
    const dataset = datasets.get(col[1]!);
    if (!dataset) warnings.push(`Regel „${rule.id}" verweist auf unbekannte Datenquelle „${col[1]}".`);
    else if (Object.keys(dataset.schema).length && !(col[2]! in dataset.schema)) {
      warnings.push(`Regel „${rule.id}": Spalte „${col[2]}" fehlt in „${col[1]}".`);
    }
  }

  for (const binding of spec.spec.bindings) {
    if (binding.from.startsWith("datasets.")) {
      const id = binding.from.slice("datasets.".length);
      const dataset = datasets.get(id);
      const to = splitPort(binding.to);
      if (!dataset) {
        warnings.push(`Verbindung von unbekannter Datenquelle „${id}".`);
        continue;
      }
      const toModule = to ? resolved.get(to.id) : undefined;
      const toPort = to ? toModule?.spec.inputs[to.port] : undefined;
      if (!to || !toModule || !toPort) {
        warnings.push(`Datenquelle „${id}" zeigt auf einen fehlenden Eingang ${binding.to}.`);
        continue;
      }
      if (toPort.semantic !== "data:table-ref" && toPort.semantic !== "data:table" && toPort.semantic !== "primitive:json") {
        warnings.push(`„${to.id}.${to.port}" (${toPort.semantic}) nimmt keine Tabelle an.`);
      }
      const known = Object.keys(dataset.schema);
      if (known.length) {
        for (const [field, column] of Object.entries(binding.mapping)) {
          if (!known.includes(column)) warnings.push(`„${id}": Spalte „${column}" für „${field}" fehlt.`);
        }
      }
      for (const field of Object.keys(toPort.schema)) {
        if (!(field in binding.mapping) && !known.includes(field)) {
          warnings.push(`„${to.id}.${to.port}" erwartet eine Zuordnung für „${field}".`);
        }
      }
      continue;
    }
    const from = splitPort(binding.from);
    const to = splitPort(binding.to);
    if (!from || !to) {
      errors.push(`Verbindung „${binding.from} → ${binding.to}" ist nicht lesbar.`);
      continue;
    }
    const fromModule = resolved.get(from.id);
    const toModule = resolved.get(to.id);
    if (!fromModule || !toModule) {
      errors.push(`Verbindung ${binding.from} → ${binding.to} zeigt auf ein fehlendes Modul.`);
      continue;
    }
    const fromPort = fromModule.spec.outputs[from.port];
    const toPort = toModule.spec.inputs[to.port];
    if (!fromPort) {
      errors.push(`„${from.id}" hat keinen Ausgang „${from.port}".`);
      continue;
    }
    if (!toPort) {
      errors.push(`„${to.id}" hat keinen Eingang „${to.port}".`);
      continue;
    }
    if (!portsCompatible(fromPort, toPort)) {
      errors.push(
        `„${from.id}.${from.port}" (${fromPort.semantic}) passt nicht zu „${to.id}.${to.port}" (${toPort.semantic}).`,
      );
    }
  }

  for (const instance of spec.spec.modules) {
    const module = resolved.get(instance.id);
    if (!module) continue;
    for (const [port, def] of Object.entries(module.spec.inputs)) {
      if (!def.required) continue;
      const wired = spec.spec.bindings.some((b) => b.to === `${instance.id}.inputs.${port}`);
      const given = instance.overrides.inputs[port] !== undefined || instance.config[port] !== undefined;
      if (!wired && !given) warnings.push(`„${instance.id}" braucht noch einen Wert für „${port}".`);
    }
    for (const secret of module.spec.requirements.secrets) {
      if (secret.required) warnings.push(`„${instance.id}" benötigt den Zugangsschlüssel ${secret.name}.`);
    }
    if (module.spec.action.hasSideEffects) {
      warnings.push(`„${instance.id}" wirkt nach außen und bleibt freigabepflichtig.`);
    }
  }

  for (const app of spec.spec.apps) {
    const missing = app.modules.filter((id) => !seen.has(id));
    if (missing.length) warnings.push(`App „${app.name}": unbekannte Module ${missing.join(", ")}.`);
  }

  return { errors, warnings };
}

/**
 * Scope spec → existing scope manifest, so the proven import path builds it.
 * Ontology rules and port wiring travel along in the settings.
 */
export function scopeSpecToManifest(spec: ScopeSpec, catalog: ModuleCatalog): ScopeManifest {
  const modules = spec.spec.modules.map((instance) => {
    const module = resolveModule(instance, catalog);
    const layout = spec.layout.canvas[instance.id];
    const nodeType = module?.metadata.nodeType ?? "note";
    const size: [number | null, number | null] = [
      layout?.width ?? module?.spec.container?.defaultSize.width ?? null,
      layout?.height ?? module?.spec.container?.defaultSize.height ?? null,
    ];
    const settings: Record<string, unknown> = {
      ...(module?.spec.settings ?? {}),
      ...instance.config,
      ...instance.overrides.inputs,
    };
    if (module) {
      settings["moduleRef"] = `${module.metadata.name}@${module.metadata.version}`;
      if (module.spec.engine.type !== "none") {
        settings["engineType"] = module.spec.engine.type;
        if (module.spec.engine.ref) settings["engineRef"] = module.spec.engine.ref;
        for (const [key, value] of Object.entries(module.spec.engine.config)) {
          if (settings[key] === undefined) settings[key] = value;
        }
      }
      if (module.spec.ontology.constraints.length) {
        settings["constraints"] = module.spec.ontology.constraints;
      }
      settings["executionMode"] = module.spec.execution.mode;
      settings["timeoutSeconds"] = module.spec.execution.timeoutSeconds;
      if (module.spec.execution.schedule) settings["schedule"] = module.spec.execution.schedule;
      if (module.spec.engine.governance) settings["governance"] = module.spec.engine.governance;
      if (module.spec.action.hasSideEffects) settings["requiresApproval"] = true;
    }
    return {
      id: instance.id,
      role: roleOf(nodeType),
      type: nodeType,
      title: instance.title ?? module?.metadata.title ?? null,
      parent: instance.parent,
      at: [Math.round(layout?.x ?? 0), Math.round(layout?.y ?? 0)] as [number, number],
      size,
      color: layout?.color ?? null,
      url: typeof settings["url"] === "string" ? (settings["url"] as string) : null,
      content: module?.metadata.description || null,
      ...(module ? { module: { name: module.metadata.name, version: module.metadata.version } } : {}),
      settings,
    };
  });

  // Named datasets become data cards holding only structure and a reference.
  const datasetModules = spec.spec.datasets.map((dataset, i) => {
    const layout = spec.layout.canvas[`datasets.${dataset.id}`] ?? spec.layout.canvas[dataset.id];
    const columns = Object.entries(dataset.schema).map(([key, type]) => ({
      key,
      label: key,
      type: type === "date" ? "date" : type,
      unit: null,
      semantic: null,
      filled: 0,
      total: 0,
    }));
    const verified = dataset.kind === "verified" || dataset.verified;
    return {
      id: `datasets.${dataset.id}`,
      role: roleOf("source"),
      type: "source",
      title: dataset.title || dataset.id,
      parent: null,
      at: [Math.round(layout?.x ?? -400), Math.round(layout?.y ?? i * 260)] as [number, number],
      size: [layout?.width ?? null, layout?.height ?? null] as [number | null, number | null],
      color: null,
      url: dataset.sourceUrl,
      content: null,
      settings: {
        ...(dataset.retention ? { retention: dataset.retention } : {}),
        source: {
          truncated: 0,
          envelope: {
            id: `src_${dataset.id}`,
            meta: {
              originKind: dataset.kind === "api" ? "stream" : "file",
              sourceName: dataset.title || dataset.id,
              format: "json",
              mediaType: null,
              checksum: "",
              ingestedAt: new Date(0).toISOString(),
              container: null,
            },
            facets: {
              dataset: { columns, rows: [], rowCount: 0 },
              datasetRef: {
                datasetId: null,
                version: 0,
                checksum: "",
                rowCount: 0,
                verified,
                sourceUrl: dataset.sourceUrl,
                fetchedAt: null,
              },
            },
            quality: { completeness: 0, confidence: 0, anomalies: [] },
            semantics: [],
          },
        },
      } as Record<string, unknown>,
    };
  });

  // Column mappings travel with the receiving module.
  for (const binding of spec.spec.bindings) {
    if (!binding.from.startsWith("datasets.") || !Object.keys(binding.mapping).length) continue;
    const to = splitPort(binding.to);
    const target = to ? modules.find((m) => m.id === to.id) : undefined;
    if (!target || !to) continue;
    const existing = (target.settings["datasetMapping"] as Record<string, unknown> | undefined) ?? {};
    target.settings["datasetMapping"] = { ...existing, [to.port]: binding.mapping };
  }

  const links = spec.spec.bindings
    .map((binding) => {
      if (binding.from.startsWith("datasets.")) {
        const to = splitPort(binding.to);
        if (!to) return null;
        return { from: binding.from, to: to.id, label: binding.label ?? `Daten → ${to.port}` };
      }
      const from = splitPort(binding.from);
      const to = splitPort(binding.to);
      if (!from || !to) return null;
      return { from: from.id, to: to.id, label: binding.label ?? `${from.port} → ${to.port}` };
    })
    .filter((link): link is NonNullable<typeof link> => link !== null);

  return {
    scopebuilder: MANIFEST_VERSION,
    scope: {
      title: spec.metadata.title,
      description: spec.metadata.description || null,
    },
    provenance: {
      version: spec.metadata.version,
      author: spec.metadata.author,
      createdAt: "",
      origin: `scope:${spec.metadata.name}`,
      checksum: "",
    },
    rules: spec.spec.ontology.rules.length ? (spec.spec.ontology as unknown as Record<string, unknown>) : {},
    mcpServers: [],
    modules: [...datasetModules, ...modules],
    links,
    apps: spec.spec.apps.map((app) => ({
      title: app.title || app.name,
      kind: app.channel === "mobile" ? "capture" : "cockpit",
      channels: [app.channel],
      modules: app.modules,
      description: app.description,
      access: app.access,
      branding: app.branding,
    })),
  };
}

function prune(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(prune);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v === null || v === undefined) continue;
      if (typeof v === "string" && v === "") continue;
      if (Array.isArray(v) && v.length === 0) continue;
      if (typeof v === "object" && !Array.isArray(v) && Object.keys(v as object).length === 0) continue;
      out[k] = prune(v);
    }
    return out;
  }
  return value;
}

export function scopeSpecToYaml(spec: ScopeSpec): string {
  return stringify(prune(spec), { lineWidth: 0 });
}
