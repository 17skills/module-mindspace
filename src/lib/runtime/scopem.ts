/**
 * Module manifest (`scopebuilder.io/v1alpha1`, kind `ScopeModule`).
 *
 * One reusable building block as a readable file (`*.scopem` / `*.scopem.yaml`).
 * A module declares WHAT it needs (inputs), HOW it works (engine), WHAT it
 * emits (outputs), WHETHER it touches the outside world (action) and WHICH
 * rules it lives by (ontology). It never contains secrets — only the
 * declaration that a secret is required.
 *
 * Invariants:
 *  - descriptions are English, so modules can be shared internationally
 *  - ports carry semantic types; the canvas only links compatible ports
 *  - a module with side effects always requires human approval
 *  - a container module (zone) is a backdrop other modules are placed on
 */
import { parse as parseYamlText, stringify } from "yaml";
import { z } from "zod";

export const MODULE_API_VERSION = "scopebuilder.io/v1alpha1";
export const MODULE_KIND = "ScopeModule";

/** Semantic port types — two ports may be linked when these match. */
export const SEMANTIC_TYPES = [
  "primitive:string",
  "primitive:number",
  "primitive:boolean",
  "primitive:json",
  "geo:point",
  "geo:features",
  "media:image",
  "media:video",
  "media:audio",
  "media:file",
  "data:table",
  "data:list",
  "text:markdown",
  "decision:judgement",
] as const;
export type SemanticType = (typeof SEMANTIC_TYPES)[number];

export const MODULE_CATEGORIES = [
  "data-source",
  "capture",
  "transform",
  "agent",
  "decision",
  "visualization",
  "output",
  "action",
  "container",
] as const;

const SEMVER = /^\d+\.\d+\.\d+$/;
/** RFC 1123 style name — lowercase, digits and dashes. */
const DNS_NAME = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

const PortSchema = z.object({
  /** Semantic contract used for link compatibility. */
  semantic: z.enum(SEMANTIC_TYPES),
  title: z.string().default(""),
  description: z.string().default(""),
  required: z.boolean().default(false),
  unit: z.string().nullable().default(null),
  /** JSON-Schema style shape for structured payloads. */
  schema: z.record(z.string(), z.unknown()).default({}),
  default: z.unknown().optional(),
  /** Where the value sits inside a raw engine response. */
  extractPath: z.string().nullable().default(null),
  /** Flat field mapping from raw response fields to output fields. */
  mapping: z.record(z.string(), z.string()).default({}),
});
export type ModulePort = z.infer<typeof PortSchema>;

const ConstraintSchema = z.object({
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
  severity: z.enum(["info", "warn", "violation"]).default("warn"),
  rationale: z.string().default(""),
  reference: z.string().nullable().default(null),
  requires: z.string().nullable().default(null),
});
export type ModuleConstraint = z.infer<typeof ConstraintSchema>;

const OntologySchema = z.object({
  domain: z.string().default(""),
  depth: z.enum(["advisory", "guarded", "strict"]).default("advisory"),
  constraints: z.array(ConstraintSchema).max(200).default([]),
});

const EngineSchema = z.object({
  type: z.enum(["none", "api", "llm", "agent", "mcp", "script"]),
  /** Model, tool or endpoint identifier. */
  ref: z.string().default(""),
  config: z.record(z.string(), z.unknown()).default({}),
  /** Guard rails for agent engines — never unbounded. */
  governance: z
    .object({
      maxSteps: z.number().int().min(1).max(50).default(5),
      maxTokenBudget: z.number().int().min(1).max(200000).default(4000),
      timeoutSeconds: z.number().int().min(1).max(300).default(45),
      allowedTools: z.array(z.string()).max(100).default([]),
      forbiddenActions: z.array(z.string()).max(100).default([]),
    })
    .optional(),
});
export type ModuleEngine = z.infer<typeof EngineSchema>;

const ExecutionSchema = z.object({
  /** reactive = runs when upstream input arrives; manual = user presses a button. */
  mode: z.enum(["reactive", "manual", "scheduled"]).default("manual"),
  schedule: z.string().nullable().default(null),
  timeoutSeconds: z.number().int().min(1).max(600).default(30),
});

const ResilienceSchema = z.object({
  retry: z
    .object({
      maxAttempts: z.number().int().min(1).max(10).default(1),
      backoff: z.enum(["none", "linear", "exponential"]).default("none"),
    })
    .default({ maxAttempts: 1, backoff: "none" }),
  cache: z
    .object({ ttlSeconds: z.number().int().min(0).max(86400).default(0) })
    .default({ ttlSeconds: 0 }),
  onError: z.enum(["halt", "continue", "fallback"]).default("halt"),
});

const ActionSchema = z.object({
  hasSideEffects: z.boolean().default(false),
  requiresApproval: z.boolean().default(false),
  approval: z
    .object({
      role: z.enum(["owner", "editor"]).default("owner"),
      summaryTemplate: z.string().default(""),
    })
    .optional(),
});

const RequirementsSchema = z.object({
  /** Secret names only — values live on the server, never in the file. */
  secrets: z
    .array(
      z.object({
        name: z.string().regex(/^[A-Z][A-Z0-9_]*$/, "Secret names are UPPER_SNAKE_CASE"),
        required: z.boolean().default(true),
        description: z.string().default(""),
      }),
    )
    .max(20)
    .default([]),
  /** Outbound hosts the module may reach (https only, enforced at runtime). */
  network: z.array(z.string()).max(20).default([]),
});

const ContainerSchema = z.object({
  isZone: z.boolean().default(false),
  acceptsChildren: z.boolean().default(false),
  defaultSize: z
    .object({ width: z.number().int().min(80).max(8000), height: z.number().int().min(80).max(8000) })
    .default({ width: 800, height: 600 }),
});

export const ScopeModuleSchema = z.object({
  apiVersion: z.literal(MODULE_API_VERSION),
  kind: z.literal(MODULE_KIND),
  metadata: z.object({
    name: z.string().regex(DNS_NAME, "Name must be lowercase letters, digits and dashes"),
    version: z.string().regex(SEMVER, "Version must be semantic, e.g. 1.0.0"),
    title: z.string().min(1),
    description: z.string().default(""),
    category: z.enum(MODULE_CATEGORIES),
    tags: z.array(z.string()).max(20).default([]),
    author: z.string().default(""),
    license: z.string().default(""),
    /** Canvas node type this module renders as. */
    nodeType: z.string().min(1),
  }),
  spec: z.object({
    ontology: OntologySchema.default({ domain: "", depth: "advisory", constraints: [] }),
    container: ContainerSchema.optional(),
    inputs: z.record(z.string(), PortSchema).default({}),
    engine: EngineSchema.default({ type: "none", ref: "", config: {} }),
    outputs: z.record(z.string(), PortSchema).default({}),
    execution: ExecutionSchema.default({ mode: "manual", schedule: null, timeoutSeconds: 30 }),
    resilience: ResilienceSchema.default({
      retry: { maxAttempts: 1, backoff: "none" },
      cache: { ttlSeconds: 0 },
      onError: "halt",
    }),
    action: ActionSchema.default({ hasSideEffects: false, requiresApproval: false }),
    requirements: RequirementsSchema.default({ secrets: [], network: [] }),
    /** Defaults copied into node metadata when the module is placed. */
    settings: z.record(z.string(), z.unknown()).default({}),
  }),
});
export type ScopeModuleSpec = z.infer<typeof ScopeModuleSchema>;

/** Catalog reference of a module, e.g. `core/camera-input@1.0.0`. */
export function moduleRef(spec: ScopeModuleSpec): string {
  return `${spec.metadata.name}@${spec.metadata.version}`;
}

/** Parse `catalog:core/name@1.0.0`, `core/name@1.0.0` or plain `name`. */
export function parseModuleRef(ref: string): { name: string; version: string | null } {
  const bare = ref.replace(/^catalog:/, "").replace(/^[\w.-]+\//, "");
  const at = bare.lastIndexOf("@");
  if (at <= 0) return { name: bare, version: null };
  return { name: bare.slice(0, at), version: bare.slice(at + 1) };
}

/** Two ports may be linked when their semantic types match exactly, or JSON accepts anything. */
export function portsCompatible(from: ModulePort, to: ModulePort): boolean {
  if (to.semantic === "primitive:json") return true;
  if (from.semantic === to.semantic) return true;
  if (from.semantic === "geo:features" && to.semantic === "data:list") return true;
  if (from.semantic === "data:list" && to.semantic === "data:table") return true;
  return false;
}

export function isModuleText(text: string): boolean {
  return /kind:\s*["']?ScopeModule/m.test(text.slice(0, 2000));
}

/** YAML (optionally with markdown frontmatter) → validated module manifest. */
export function parseScopeModule(text: string): ScopeModuleSpec {
  const front = /^\s*---\s*\n([\s\S]*?)\n---\s*(?:\n|$)/.exec(text);
  const yamlPart = front ? (front[1] ?? "") : text;
  let raw: unknown;
  try {
    raw = parseYamlText(yamlPart);
  } catch (error) {
    throw new Error(`Die Datei ist kein lesbares YAML: ${error instanceof Error ? error.message : ""}`);
  }
  const result = ScopeModuleSchema.safeParse(raw);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new Error(
      `Kein gültiger Baustein (${issue?.path.join(".") || "Kopf"}: ${issue?.message ?? "unbekannt"})`,
    );
  }
  const spec = result.data;
  if (spec.spec.action.hasSideEffects && !spec.spec.action.requiresApproval) {
    // Safety net: outside effects are never silently automatic.
    spec.spec.action.requiresApproval = true;
  }
  return spec;
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

export function scopeModuleToYaml(spec: ScopeModuleSpec): string {
  return stringify(prune(spec), { lineWidth: 0 });
}
