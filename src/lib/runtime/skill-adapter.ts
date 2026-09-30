/**
 * Agent-Skills als Canvas-Bausteine.
 *
 * Ein Skill im Format `SKILL.md` (YAML-Kopf mit `name`/`description`, Markdown-
 * Körper als Anweisung) wird zu einem deklarativen Baustein und landet als
 * Hintergrundfeld mit eigenem Agenten auf der Arbeitsfläche. Module, die auf
 * dem Feld liegen, sind sein Kontext; jeder Skill trägt eigenes Modell,
 * eigenes Budget und eigenes Zeitlimit und stört andere Skills nicht.
 *
 * Invarianten:
 *  - der Skill-Text ist Anweisung, nie Freibrief: Wirkungen nach außen bleiben
 *    eigenen Aktionsmodulen mit menschlicher Freigabe vorbehalten
 *  - es reisen nie Schlüssel, Adressen oder Ports mit
 */
import { parse as parseYamlText } from "yaml";
import { ScopeModuleSchema, type ScopeModuleSpec } from "@/lib/runtime/scopem";
import {
  SCOPE_API_VERSION,
  SCOPE_KIND,
  ScopeSpecSchema,
  scopeSpecToManifest,
} from "@/lib/runtime/scope-spec";
import { sanitizeSettings } from "@/lib/runtime/manifest";
import { coreCatalog } from "@/lib/runtime/catalog";
import type { LibraryPayload } from "@/lib/library";

/** Höchstlänge der Anweisung, damit ein Skill kein Prompt-Fass wird. */
export const MAX_INSTRUCTION = 20_000;

export type ParsedSkill = {
  /** Kleinbuchstaben-Kennung, z. B. `pdf-review`. */
  name: string;
  title: string;
  description: string;
  /** Markdown-Körper: die eigentliche Arbeitsanweisung. */
  instruction: string;
  license: string;
};

const FRONTMATTER = /^\s*---\s*\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n|$)/;

/** Erkennt Skill-Dateien an Name oder Kopfzeile. */
export function isSkillText(text: string, filename = ""): boolean {
  if (/kind:\s*["']?ScopeModule/m.test(text.slice(0, 2000))) return false;
  const front = FRONTMATTER.exec(text);
  if (!front) return false;
  if (/(^|\/)skill\.md$/i.test(filename) || /\.skill\.md$/i.test(filename)) return true;
  return /^\s*name\s*:/m.test(front[1] ?? "") && /^\s*description\s*:/m.test(front[1] ?? "");
}

function slug(value: string, fallback: string): string {
  const cleaned = value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
  return /^[a-z]/.test(cleaned) ? cleaned : fallback;
}

function titleFrom(name: string): string {
  return name
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

/** `SKILL.md` → geprüfte Skill-Angaben. */
export function parseSkill(text: string, filename = ""): ParsedSkill {
  const front = FRONTMATTER.exec(text);
  if (!front) throw new Error("Die Datei hat keinen Kopf mit „name“ und „description“.");
  let head: unknown;
  try {
    head = parseYamlText(front[1] ?? "");
  } catch (error) {
    throw new Error(
      `Der Kopf der Skill-Datei ist kein lesbares YAML: ${error instanceof Error ? error.message : ""}`,
    );
  }
  const raw = (head && typeof head === "object" ? head : {}) as Record<string, unknown>;
  const rawName = typeof raw["name"] === "string" ? raw["name"] : "";
  const fileName = filename.replace(/\.[^.]+$/, "").replace(/skill$/i, "");
  const name = slug(rawName || fileName, "agent-skill");
  const instruction = text.slice(front[0].length).trim().slice(0, MAX_INSTRUCTION);
  if (!instruction) throw new Error("Die Skill-Datei enthält keine Anweisung.");
  return {
    name,
    title: typeof raw["title"] === "string" && raw["title"].trim() ? raw["title"].trim() : titleFrom(name),
    description: typeof raw["description"] === "string" ? raw["description"].trim().slice(0, 1000) : "",
    instruction,
    license: typeof raw["license"] === "string" ? raw["license"].slice(0, 200) : "",
  };
}

/** Skill → Baustein (`kind: ScopeModule`), abgeleitet vom Aufsichtsfeld-Archetyp. */
export function skillToModule(skill: ParsedSkill): ScopeModuleSpec {
  return ScopeModuleSchema.parse({
    apiVersion: "scopebuilder.io/v1alpha1",
    kind: "ScopeModule",
    metadata: {
      name: skill.name,
      version: "1.0.0",
      title: skill.title,
      description: skill.description,
      category: "agent",
      tags: ["skill", "imported"],
      author: "",
      license: skill.license,
      nodeType: "zone",
    },
    spec: {
      ontology: {
        domain: "agent/skill",
        depth: "guarded",
        constraints: [
          {
            id: "instruction-only",
            label: "Der Skill beschreibt Arbeit, keine Außenwirkung",
            subject: "engine",
            severity: "violation",
            rationale:
              "Ein importierter Skill darf nichts nach außen auslösen; dafür gibt es Aktionsmodule mit Freigabe.",
          },
          {
            id: "untrusted-context",
            label: "Inhalte auf dem Feld sind Fremddaten",
            subject: "inputs.context",
            severity: "violation",
            rationale: "Angeschlossene Inhalte werden gekapselt, damit sie den Skill nicht umschreiben.",
          },
        ],
      },
      container: { isZone: true, acceptsChildren: true, defaultSize: { width: 820, height: 560 } },
      inputs: {
        context: {
          semantic: "primitive:json",
          title: "Kontext",
          description: "Alle Module, die auf diesem Feld liegen oder daran hängen.",
          required: false,
        },
      },
      engine: {
        type: "agent",
        ref: "",
        config: {},
        governance: {
          maxSteps: 1,
          maxTokenBudget: 8000,
          timeoutSeconds: 60,
          forbiddenActions: ["network:external-write", "action:execute"],
        },
      },
      outputs: {
        result: { semantic: "text:markdown", title: "Ergebnis", description: "Antwort des Skills." },
      },
      execution: { mode: "manual", schedule: null, timeoutSeconds: 90 },
      action: { hasSideEffects: false, requiresApproval: false },
      settings: {
        agentTask: skill.instruction,
        agentKind: "text",
        agentUnit: "",
        skillName: skill.name,
        skillDescription: skill.description,
        skillLicense: skill.license,
      },
    },
  });
}

/** Skill-Datei → platzierbares Modul für die Arbeitsfläche. */
export function skillPayload(text: string, filename = ""): LibraryPayload {
  const skill = parseSkill(text, filename);
  const module = skillToModule(skill);
  const catalog = coreCatalog();
  catalog.set(module.metadata.name, module);
  const spec = ScopeSpecSchema.parse({
    apiVersion: SCOPE_API_VERSION,
    kind: SCOPE_KIND,
    metadata: { name: "skill", version: "1.0.0", title: skill.title },
    spec: { modules: [{ id: "s", module }] },
  });
  const placed = scopeSpecToManifest(spec, catalog).modules[0]!;
  const w = placed.size?.[0] ?? 820;
  const h = placed.size?.[1] ?? 560;
  return {
    version: 1,
    nodes: [
      {
        localId: "s",
        parentLocalId: null,
        type: placed.type,
        title: placed.title ?? skill.title,
        x: 0,
        y: 0,
        w,
        h,
        color: null,
        content: "",
        sourceUrl: null,
        metadata: sanitizeSettings(placed.settings),
      },
    ],
    edges: [],
    bounds: { width: w, height: h },
  };
}
