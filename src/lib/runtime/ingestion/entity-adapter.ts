/**
 * Structured ingestion: YAML and JSON stay hierarchical.
 * They are never squeezed into a one-row table — they become an entity facet.
 */
import { parse as parseYamlText } from "yaml";
import type { FieldSpec, StructuredEntity, ValueType } from "@/lib/runtime/source-protocol";
import { semanticOf } from "./typing";

function typeOf(value: unknown): ValueType | "object" | "list" {
  if (value == null) return "unknown";
  if (Array.isArray(value)) return "list";
  if (typeof value === "object") return "object";
  if (typeof value === "number") return "number";
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "string") {
    return /^\d{4}-\d{2}-\d{2}/.test(value) ? "date" : "text";
  }
  return "unknown";
}

/** Flat field list with dotted paths — the schema of the entity. */
export function describeSchema(data: unknown, prefix = "", depth = 0): FieldSpec[] {
  if (depth > 4 || data == null || typeof data !== "object") return [];
  const fields: FieldSpec[] = [];
  const entries = Array.isArray(data)
    ? data.slice(0, 20).map((value, index) => [String(index), value] as const)
    : Object.entries(data as Record<string, unknown>);

  for (const [key, value] of entries) {
    const path = prefix ? `${prefix}.${key}` : key;
    fields.push({ path, type: typeOf(value), semantic: semanticOf(key) });
    if (value && typeof value === "object") {
      fields.push(...describeSchema(value, path, depth + 1));
    }
  }
  return fields;
}

const KIND_HINTS: Array<{ kind: string; pattern: RegExp }> = [
  { kind: "Rolle", pattern: /(^|\.)?(role|rolle|persona|verantwortlich|zustaendigkeit)/i },
  { kind: "Regelwerk", pattern: /(rule|regel|policy|richtlinie|grenzwert|threshold|vollmacht|limit)/i },
  { kind: "Prozess", pattern: /(process|prozess|workflow|gate|schritt|step|bpmn)/i },
  { kind: "Konfiguration", pattern: /(config|konfig|settings|einstellung)/i },
];

/** Best-effort label: what kind of declarative content is this? */
export function detectKind(data: unknown, schema: FieldSpec[]): string {
  const haystack = schema.map((field) => field.path).join(" ");
  for (const hint of KIND_HINTS) {
    if (hint.pattern.test(haystack)) return hint.kind;
  }
  return Array.isArray(data) ? "Liste" : "Struktur";
}

export function buildEntity(data: unknown): StructuredEntity {
  const normalised: Record<string, unknown> =
    data && typeof data === "object" && !Array.isArray(data)
      ? (data as Record<string, unknown>)
      : { items: data };
  const schema = describeSchema(normalised);
  return { kind: detectKind(data, schema), schema, data: normalised };
}

export function parseYaml(text: string): StructuredEntity {
  return buildEntity(parseYamlText(text) ?? {});
}

export function parseJson(text: string): StructuredEntity {
  return buildEntity(JSON.parse(text));
}
