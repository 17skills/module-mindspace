/**
 * Export/Import von Abfragevorlagen als JSON.
 * Enthält nur Titel, Auswertung, benötigte Spalten, Kategorie und Tags —
 * nie Datenzeilen, Nutzerkennungen oder Schlüssel. Import prüft jede Vorlage
 * streng und überspringt Ungültiges, statt es still zu übernehmen.
 */
import { readChartConfig, type ChartConfig } from "@/lib/chart-config";

export const TEMPLATE_FORMAT = "scopebuilder/query-templates";
export const TEMPLATE_FORMAT_VERSION = 1;
export const MAX_IMPORT_BYTES = 1_000_000;
export const MAX_IMPORT_TEMPLATES = 200;

export type PortableTemplate = {
  title: string;
  config: ChartConfig;
  columns: string[];
  category: string;
  tags: string[];
};

export type ImportResult = {
  templates: PortableTemplate[];
  skipped: number;
  error?: string;
};

function cleanTags(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  for (const raw of input) {
    if (typeof raw !== "string") continue;
    const tag = raw.trim().toLowerCase().slice(0, 30);
    if (tag) seen.add(tag);
  }
  return [...seen].slice(0, 20);
}

function cleanColumns(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  return [...new Set(input.filter((c): c is string => typeof c === "string" && !!c.trim()).map((c) => c.slice(0, 120)))].slice(0, 100);
}

export function exportTemplates(rows: PortableTemplate[], now: Date = new Date()): string {
  return JSON.stringify(
    {
      format: TEMPLATE_FORMAT,
      version: TEMPLATE_FORMAT_VERSION,
      exportedAt: now.toISOString(),
      templates: rows.map((r) => ({
        title: r.title,
        config: r.config,
        columns: r.columns,
        category: r.category,
        tags: r.tags,
      })),
    },
    null,
    2,
  );
}

export function parseTemplateImport(text: string): ImportResult {
  if (text.length > MAX_IMPORT_BYTES) {
    return { templates: [], skipped: 0, error: "Die Datei ist zu groß (maximal 1 MB)." };
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { templates: [], skipped: 0, error: "Die Datei ist kein gültiges JSON." };
  }
  const root = json as { format?: unknown; version?: unknown; templates?: unknown } | null;
  if (!root || typeof root !== "object" || root.format !== TEMPLATE_FORMAT) {
    return { templates: [], skipped: 0, error: "Das ist keine Export-Datei von Abfragevorlagen." };
  }
  if (typeof root.version !== "number" || root.version > TEMPLATE_FORMAT_VERSION) {
    return { templates: [], skipped: 0, error: "Diese Datei stammt aus einer neueren Version und kann nicht gelesen werden." };
  }
  if (!Array.isArray(root.templates)) {
    return { templates: [], skipped: 0, error: "Die Datei enthält keine Vorlagen." };
  }

  const templates: PortableTemplate[] = [];
  let skipped = Math.max(0, root.templates.length - MAX_IMPORT_TEMPLATES);
  for (const raw of root.templates.slice(0, MAX_IMPORT_TEMPLATES)) {
    const item = raw as Record<string, unknown> | null;
    const title = typeof item?.["title"] === "string" ? item["title"].trim().slice(0, 120) : "";
    const config = item ? readChartConfig({ chartConfig: item["config"] }) : null;
    if (!title || !config) {
      skipped += 1;
      continue;
    }
    templates.push({
      title,
      config,
      columns: cleanColumns(item?.["columns"]),
      category: typeof item?.["category"] === "string" ? item["category"].trim().slice(0, 60) : "",
      tags: cleanTags(item?.["tags"]),
    });
  }
  return { templates, skipped };
}

/** Schlüssel zum Erkennen von Duplikaten (gleicher Name und gleiche Auswertung). */
export function templateKey(t: { title: string; config: ChartConfig }): string {
  return `${t.title.trim().toLowerCase()}::${JSON.stringify(t.config)}`;
}

/** Teilt Importkandidaten in neu und bereits vorhanden (auch innerhalb der Datei doppelt). */
export function classifyImport(
  incoming: PortableTemplate[],
  existing: { title: string; config: ChartConfig }[],
): { fresh: PortableTemplate[]; duplicates: PortableTemplate[] } {
  const seen = new Set(existing.map(templateKey));
  const fresh: PortableTemplate[] = [];
  const duplicates: PortableTemplate[] = [];
  for (const t of incoming) {
    const key = templateKey(t);
    if (seen.has(key)) {
      duplicates.push(t);
    } else {
      seen.add(key);
      fresh.push(t);
    }
  }
  return { fresh, duplicates };
}
