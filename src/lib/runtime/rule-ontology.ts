/**
 * Basis-Ontologie.
 *
 * Optionales, schlankes Rückgrat: Regeln und Leitplanken (Vollmachten,
 * Budgetgrenzen, Norm- und Sicherheitsschwellen, Richtlinien). Die Tiefe
 * bestimmt der Kunde — von einem einzigen Schwellenwert bis zum Katalog.
 *
 * Invarianten:
 *  - Regeln warnen, sie schalten nie ab (Signalgeber, kein Vollstrecker)
 *  - jede Regelverletzung hat eine Klartext-Begründung und eine Quelle
 *  - Einheiten werden nie implizit umgerechnet
 *  - fehlende Daten ergeben "unbekannt", niemals einen stillen Pass
 */
import { z } from "zod";
import {
  type SemanticTag,
  type SourceEnvelope,
  type Unit,
} from "@/lib/runtime/source-protocol";

export type RuleOperator =
  | "lte"
  | "gte"
  | "lt"
  | "gt"
  | "eq"
  | "neq"
  | "between"
  | "oneOf"
  | "required";

export type RuleSeverity = "info" | "warn" | "violation";

/** Wie streng eine Ontologie gelebt wird — der Kunde entscheidet. */
export type OntologyDepth = "advisory" | "guarded" | "strict";

const unitSchema = z.enum([
  "EUR",
  "kEUR",
  "percent",
  "bar",
  "celsius",
  "hours",
  "days",
  "count",
  "score",
]);

const semanticSchema = z.enum([
  "amount",
  "probability",
  "severity",
  "priority",
  "date",
  "status",
  "identifier",
  "location",
  "role",
  "rule",
  "measurement",
  "text",
]);

const ruleSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  /** Spaltenschlüssel, Feldpfad oder semantisches Tag, auf das die Regel zielt. */
  subject: z.string().min(1),
  subjectSemantic: semanticSchema.nullish(),
  operator: z.enum(["lte", "gte", "lt", "gt", "eq", "neq", "between", "oneOf", "required"]),
  value: z.union([z.number(), z.string(), z.boolean(), z.array(z.union([z.number(), z.string()]))]).nullish(),
  unit: unitSchema.nullish(),
  severity: z.enum(["info", "warn", "violation"]).default("warn"),
  /** Klartext: warum es diese Regel gibt. */
  rationale: z.string().nullish(),
  /** Norm, Richtlinie oder Beschluss, auf den sich die Regel stützt. */
  reference: z.string().nullish(),
  /** Was der Mensch tun muss, wenn die Regel greift. */
  requires: z.string().nullish(),
});

export const ontologySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  version: z.string().default("1"),
  description: z.string().nullish(),
  depth: z.enum(["advisory", "guarded", "strict"]).default("advisory"),
  rules: z.array(ruleSchema).default([]),
});

export type OntologyRule = z.infer<typeof ruleSchema>;
export type Ontology = z.infer<typeof ontologySchema>;

export type FindingStatus = "pass" | "warn" | "violation" | "unknown";

export interface RuleFinding {
  ruleId: string;
  label: string;
  status: FindingStatus;
  /** Verständlicher Satz für Entscheider. */
  message: string;
  subject: string;
  actual: number | string | boolean | null;
  reference: string | null;
  requires: string | null;
  /** Zeile der Quelle, falls die Regel auf eine Tabelle traf. */
  row: number | null;
}

/* ------------------------------------------------------------------ */
/* Parsing                                                             */
/* ------------------------------------------------------------------ */

export interface OntologyParseResult {
  ontology: Ontology | null;
  errors: string[];
}

/** Nimmt ein beliebiges Objekt (aus YAML/JSON) und prüft es gegen das Schema. */
export function parseOntology(input: unknown): OntologyParseResult {
  const result = ontologySchema.safeParse(input);
  if (result.success) return { ontology: result.data, errors: [] };
  return {
    ontology: null,
    errors: result.error.issues.map((issue) => `${issue.path.join(".") || "(Wurzel)"}: ${issue.message}`),
  };
}

/**
 * Regel-Importeur: eine als Quelle aufgenommene YAML/JSON-Datei wird zur
 * lokalen Leitplanke. Kein Konzern baut seine Ontologie hier neu.
 */
export function ontologyFromEnvelope(envelope: SourceEnvelope): OntologyParseResult {
  const entity = envelope.facets.entity;
  if (!entity) {
    return { ontology: null, errors: ["Quelle enthält keine strukturierten Regeln."] };
  }
  const data = entity.data as Record<string, unknown>;
  const candidate = {
    id: typeof data["id"] === "string" ? data["id"] : envelope.id,
    name: typeof data["name"] === "string" ? data["name"] : envelope.meta.sourceName,
    ...data,
  };
  return parseOntology(candidate);
}

/* ------------------------------------------------------------------ */
/* Auswertung                                                          */
/* ------------------------------------------------------------------ */

function formatValue(value: unknown, unit?: Unit | null): string {
  if (value == null || value === "") return "kein Wert";
  if (typeof value === "number") {
    const formatted = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 2 }).format(value);
    return unit ? `${formatted} ${unit}` : formatted;
  }
  return String(value);
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value.replace(/\./g, "").replace(",", "."));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function bounds(value: OntologyRule["value"]): [number, number] | null {
  if (!Array.isArray(value) || value.length < 2) return null;
  const low = asNumber(value[0]);
  const high = asNumber(value[1]);
  return low != null && high != null ? [low, high] : null;
}

function verdict(rule: OntologyRule, holds: boolean): FindingStatus {
  if (holds) return "pass";
  return rule.severity === "violation" ? "violation" : rule.severity === "info" ? "pass" : "warn";
}

/** Prüft eine Regel gegen genau einen Wert. Fehlender Wert ⇒ "unknown". */
export function evaluateRule(
  rule: OntologyRule,
  actual: unknown,
  row: number | null = null,
): RuleFinding {
  const base = {
    ruleId: rule.id,
    label: rule.label,
    subject: rule.subject,
    reference: rule.reference ?? null,
    requires: rule.requires ?? null,
    row,
  };
  const missing = actual == null || actual === "";

  if (rule.operator === "required") {
    const holds = !missing;
    return {
      ...base,
      status: verdict(rule, holds),
      actual: missing ? null : (actual as number | string | boolean),
      message: holds
        ? `${rule.label}: Angabe vorhanden.`
        : `${rule.label}: Pflichtangabe „${rule.subject}“ fehlt.`,
    };
  }

  if (missing) {
    return {
      ...base,
      status: "unknown",
      actual: null,
      message: `${rule.label}: kein Wert für „${rule.subject}“ – Regel nicht prüfbar.`,
    };
  }

  const num = asNumber(actual);
  const expected = rule.value;
  let holds = true;
  let expectation = "";

  switch (rule.operator) {
    case "lte":
    case "lt":
    case "gte":
    case "gt": {
      const limit = asNumber(expected);
      if (num == null || limit == null) {
        return {
          ...base,
          status: "unknown",
          actual: typeof actual === "boolean" ? actual : String(actual),
          message: `${rule.label}: Wert „${String(actual)}“ ist keine Zahl – Regel nicht prüfbar.`,
        };
      }
      holds =
        rule.operator === "lte"
          ? num <= limit
          : rule.operator === "lt"
            ? num < limit
            : rule.operator === "gte"
              ? num >= limit
              : num > limit;
      const words: Record<string, string> = {
        lte: "höchstens",
        lt: "unter",
        gte: "mindestens",
        gt: "über",
      };
      expectation = `${words[rule.operator]} ${formatValue(limit, rule.unit)}`;
      break;
    }
    case "between": {
      const range = bounds(expected ?? null);
      if (num == null || !range) {
        return {
          ...base,
          status: "unknown",
          actual: num,
          message: `${rule.label}: Grenzwerte unvollständig – Regel nicht prüfbar.`,
        };
      }
      holds = num >= range[0] && num <= range[1];
      expectation = `zwischen ${formatValue(range[0], rule.unit)} und ${formatValue(range[1], rule.unit)}`;
      break;
    }
    case "oneOf": {
      const allowed = Array.isArray(expected) ? expected.map(String) : [];
      holds = allowed.includes(String(actual));
      expectation = `einer von: ${allowed.join(", ")}`;
      break;
    }
    case "eq":
      holds = String(actual) === String(expected);
      expectation = `gleich ${formatValue(expected, rule.unit)}`;
      break;
    case "neq":
      holds = String(actual) !== String(expected);
      expectation = `ungleich ${formatValue(expected, rule.unit)}`;
      break;
  }

  const status = verdict(rule, holds);
  const actualText = formatValue(actual, rule.unit);
  const message = holds
    ? `${rule.label}: ${actualText} liegt im zulässigen Rahmen (${expectation}).`
    : `${rule.label}: ${actualText} verletzt die Vorgabe ${expectation}.` +
      (rule.requires ? ` Erforderlich: ${rule.requires}.` : "") +
      (rule.reference ? ` Grundlage: ${rule.reference}.` : "");

  return {
    ...base,
    status,
    actual: typeof actual === "boolean" ? actual : (num ?? String(actual)),
    message,
  };
}

/** Findet den Wert, auf den eine Regel zielt: Spaltenschlüssel, Label oder Semantik. */
function pickValue(
  rule: OntologyRule,
  values: Record<string, unknown>,
  semanticIndex: Map<SemanticTag, string[]>,
): unknown {
  const direct = values[rule.subject];
  if (direct !== undefined) return direct;

  const lower = rule.subject.toLowerCase();
  for (const [key, value] of Object.entries(values)) {
    if (key.toLowerCase() === lower) return value;
  }
  if (rule.subjectSemantic) {
    for (const key of semanticIndex.get(rule.subjectSemantic) ?? []) {
      if (values[key] !== undefined) return values[key];
    }
  }
  return undefined;
}

function flatten(data: Record<string, unknown>, prefix = ""): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    const path = prefix ? `${prefix}.${key}` : key;
    out[path] = value;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      Object.assign(out, flatten(value as Record<string, unknown>, path));
    }
  }
  return out;
}

export interface OntologyEvaluation {
  ontologyId: string;
  findings: RuleFinding[];
  violations: number;
  warnings: number;
  unknowns: number;
  /** Anteil der prüfbaren Regeln, die bestanden wurden (0..1, null ohne Prüfung). */
  coverage: number | null;
}

/** Wertet eine Ontologie gegen eine Quelle aus — Tabelle zeilenweise, Struktur feldweise. */
export function evaluateOntology(
  ontology: Ontology,
  envelope: SourceEnvelope,
  options: { maxRows?: number } = {},
): OntologyEvaluation {
  const findings: RuleFinding[] = [];
  const dataset = envelope.facets.dataset;

  if (dataset) {
    const semanticIndex = new Map<SemanticTag, string[]>();
    for (const column of dataset.columns) {
      if (!column.semantic) continue;
      const list = semanticIndex.get(column.semantic) ?? [];
      list.push(column.key);
      semanticIndex.set(column.semantic, list);
    }
    const rows = dataset.rows.slice(0, options.maxRows ?? 500);
    for (const row of rows) {
      for (const rule of ontology.rules) {
        findings.push(evaluateRule(rule, pickValue(rule, row.values, semanticIndex), row.index));
      }
    }
  } else if (envelope.facets.entity) {
    const flat = flatten(envelope.facets.entity.data);
    const semanticIndex = new Map<SemanticTag, string[]>();
    for (const field of envelope.facets.entity.schema) {
      if (!field.semantic) continue;
      const list = semanticIndex.get(field.semantic) ?? [];
      list.push(field.path);
      semanticIndex.set(field.semantic, list);
    }
    for (const rule of ontology.rules) {
      findings.push(evaluateRule(rule, pickValue(rule, flat, semanticIndex), null));
    }
  } else {
    for (const rule of ontology.rules) {
      findings.push({
        ruleId: rule.id,
        label: rule.label,
        status: "unknown",
        subject: rule.subject,
        actual: null,
        reference: rule.reference ?? null,
        requires: rule.requires ?? null,
        row: null,
        message: `${rule.label}: Quelle liefert keine prüfbaren Werte.`,
      });
    }
  }

  const violations = findings.filter((f) => f.status === "violation").length;
  const warnings = findings.filter((f) => f.status === "warn").length;
  const unknowns = findings.filter((f) => f.status === "unknown").length;
  const checked = findings.length - unknowns;
  const passed = findings.filter((f) => f.status === "pass").length;

  return {
    ontologyId: ontology.id,
    findings,
    violations,
    warnings,
    unknowns,
    coverage: checked ? Math.round((passed / checked) * 100) / 100 : null,
  };
}

/** Verdichtet viele Zeilenbefunde zu je einer Zeile pro Regel (schlimmster Fall zuerst). */
export function summarizeFindings(findings: RuleFinding[]): RuleFinding[] {
  const rank: Record<FindingStatus, number> = { violation: 3, warn: 2, unknown: 1, pass: 0 };
  const worst = new Map<string, RuleFinding>();
  for (const finding of findings) {
    const current = worst.get(finding.ruleId);
    if (!current || rank[finding.status] > rank[current.status]) worst.set(finding.ruleId, finding);
  }
  return [...worst.values()].sort((a, b) => rank[b.status] - rank[a.status]);
}
