/**
 * Semantische Rolle eines Canvas-Knotens in einer ausgelieferten App.
 *
 * Ein Textzettel ist nicht gleich Textzettel: er kann Leitfaden, System-Prompt,
 * Regel oder reine Arbeitsnotiz sein. Ein Link kann Wissensquelle oder
 * Aktionssprung sein. Die Rolle entscheidet, ob und wie das Element in der App
 * erscheint — als Kachel, als Einleitung, im Nachweisverzeichnis oder gar nicht.
 *
 * Invariants:
 *  - die Rolle liegt in `metadata.moduleRole`; fehlt sie, gilt die Ableitung
 *  - nur Rolle "module" belegt einen Platz im App-Raster
 *  - "prompt" und "draft" werden nie sichtbar ausgeliefert
 */
import type { NodeRecord } from "@/components/canvas/board-context";

export type ModuleRole = "module" | "briefing" | "prompt" | "rule" | "reference" | "action" | "draft";

/** Fachliche Klasse eines Moduls — ordnet die Auswahl im App-Studio. */
export type ModuleClass = "domain" | "analytics" | "io" | "context";

export const ROLE_LABEL: Record<ModuleRole, string> = {
  module: "Modul (Kachel)",
  briefing: "Leitfaden / Briefing",
  prompt: "System-Prompt",
  rule: "Regel / Kriterium",
  reference: "Quelle / Nachweis",
  action: "Aktionssprung",
  draft: "Arbeitsnotiz (nur Canvas)",
};

export const ROLE_HINT: Record<ModuleRole, string> = {
  module: "Wird als eigene Kachel in der App dargestellt.",
  briefing: "Erscheint als Einleitung oben in der App.",
  prompt: "Fließt als Anweisung in das verbundene KI-Modul – keine Kachel.",
  rule: "Dient als Kriterium für Entscheidungen und Prüfschritte.",
  reference: "Erscheint in der App unter „Quellen & Nachweise“.",
  action: "Erscheint als Absprung-Knopf in der App.",
  draft: "Bleibt auf der Arbeitsfläche und wird nicht ausgeliefert.",
};

export const CLASS_LABEL: Record<ModuleClass, string> = {
  domain: "Fachmodule & Standards",
  analytics: "Kennzahlen & Analytik",
  io: "Schnittstellen & Ergebnisse",
  context: "Leitfaden, Prompts & Quellen",
};

/** Kurzer Standard-Hinweis für ein Fachmodul, z. B. „ISO 55001“. */
export const TYPE_STANDARD: Record<string, string> = {
  risk: "ISO 55001",
  decision: "JEV",
  inspect: "Zustandserfassung",
  map: "Geodaten",
};

const DOMAIN_TYPES = new Set(["risk", "decision", "inspect", "map", "camera", "signal"]);
const ANALYTICS_TYPES = new Set(["metric", "gauge", "chart", "table", "list", "sheet", "calc", "note", "quotes"]);
const IO_TYPES = new Set(["output", "api", "mcp", "mcphub", "action", "source"]);
/** Knoten, deren Rolle der Nutzer frei wählen kann. */
const CONTEXT_TYPES = new Set(["text", "link", "document", "file", "note"]);

export function moduleClass(type: string): ModuleClass {
  if (DOMAIN_TYPES.has(type)) return "domain";
  if (ANALYTICS_TYPES.has(type)) return "analytics";
  if (IO_TYPES.has(type)) return "io";
  return "context";
}

/** Rollen, die für diese Knotenart sinnvoll sind. */
export function rolesFor(type: string): ModuleRole[] {
  if (type === "text") return ["briefing", "prompt", "rule", "draft", "module"];
  if (type === "link" || type === "document" || type === "file") {
    return ["reference", "action", "briefing", "draft", "module"];
  }
  if (CONTEXT_TYPES.has(type)) return ["module", "briefing", "rule", "draft"];
  return ["module"];
}

/** Darf der Nutzer die Rolle dieses Knotens wählen? */
export function roleEditable(type: string): boolean {
  return rolesFor(type).length > 1;
}

/**
 * Abgeleitete Rolle, wenn nichts gespeichert ist.
 * `feedsAgent` = der Knoten hängt am Eingang eines KI- oder Agenten-Moduls.
 */
export function inferRole(type: string, feedsAgent = false): ModuleRole {
  if (type === "text") return feedsAgent ? "prompt" : "briefing";
  if (type === "link" || type === "document" || type === "file") return "reference";
  return "module";
}

/** Gespeicherte Rolle lesen, sonst ableiten. */
export function readModuleRole(node: Pick<NodeRecord, "type" | "metadata">, feedsAgent = false): ModuleRole {
  const raw = node.metadata?.["moduleRole"];
  const allowed = rolesFor(node.type);
  if (typeof raw === "string" && (allowed as string[]).includes(raw)) return raw as ModuleRole;
  return inferRole(node.type, feedsAgent);
}

/** Nur diese Rolle belegt einen Platz im App-Raster. */
export function isTileRole(role: ModuleRole): boolean {
  return role === "module";
}

/** Erscheint das Element überhaupt in der ausgelieferten App? */
export function isVisibleInApp(role: ModuleRole): boolean {
  return role !== "prompt" && role !== "draft";
}
