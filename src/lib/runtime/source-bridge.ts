/**
 * Brücke von der Quelle in die Logik: Source → Logic.
 *
 * Eine Quelle ist eine Quelle ist eine Quelle — die Brücke liest nur den
 * Umschlag und übersetzt ihn in das, was ein Logik-Modul versteht:
 * Risikozeilen (Eintritt × Auswirkung) und eine Klartext-Grundlage für die
 * Entscheidung. Sie bewertet nie selbst und verwirft nie eine Zeile:
 * fehlende Werte bleiben sichtbar als Lücke.
 */
import type { ColumnSpec, SourceEnvelope, TabularDataset } from "@/lib/runtime/source-protocol";
import type { RuleFinding } from "@/lib/runtime/rule-ontology";
import type { StoredSource } from "@/lib/source-node";

/* ------------------------------------------------------------------ */
/* Spaltenerkennung                                                    */
/* ------------------------------------------------------------------ */

const LABEL_WORDS = ["risiko", "gefahr", "gefährdung", "bezeichnung", "titel", "name", "massnahme", "maßnahme", "thema", "objekt", "anlage"];
const CHANCE_WORDS = ["eintritt", "eintrittswahrscheinlichkeit", "wahrscheinlichkeit", "häufigkeit", "haeufigkeit", "likelihood", "probability", "chance", "frequency"];
const IMPACT_WORDS = ["auswirkung", "schaden", "schadensausmaß", "schadensausmass", "ausmaß", "ausmass", "tragweite", "impact", "severity", "consequence"];

function normalize(text: string): string {
  return text.toLowerCase().replace(/[\s_.-]+/g, "");
}

function matches(column: ColumnSpec, words: string[]): boolean {
  const label = normalize(`${column.label} ${column.key}`);
  return words.some((word) => label.includes(normalize(word)));
}

export interface RiskColumns {
  label: ColumnSpec | null;
  chance: ColumnSpec | null;
  impact: ColumnSpec | null;
}

/** Findet die Spalten für Bezeichnung, Eintritt und Auswirkung. */
export function riskColumns(dataset: TabularDataset): RiskColumns {
  const bySemantic = (tag: string) => dataset.columns.find((column) => column.semantic === tag) ?? null;
  const byWords = (words: string[]) => dataset.columns.find((column) => matches(column, words)) ?? null;

  const chance = byWords(CHANCE_WORDS) ?? bySemantic("probability");
  const impact = byWords(IMPACT_WORDS) ?? bySemantic("severity");
  const label =
    byWords(LABEL_WORDS) ??
    dataset.columns.find(
      (column) => column.type === "text" && column.key !== chance?.key && column.key !== impact?.key,
    ) ??
    null;
  return { label, chance, impact };
}

/* ------------------------------------------------------------------ */
/* Risikozeilen                                                        */
/* ------------------------------------------------------------------ */

export interface SourceRiskRow {
  id: string;
  label: string;
  /** Eintritt 1..5, null wenn die Quelle nichts hergibt. */
  chance: number | null;
  /** Auswirkung 1..5, null wenn die Quelle nichts hergibt. */
  impact: number | null;
  /** Zeilennummer in der Ursprungsdatei — Nachweiskette. */
  row: number;
  sourceName: string;
  /** Was in dieser Zeile fehlt, im Klartext. */
  missing: string[];
}

/** Überträgt eine Zahl aus der Quelle in die 1..5-Skala der Matrix. */
export function toLevel(value: unknown, unit: ColumnSpec["unit"]): number | null {
  if (value == null || value === "") return null;
  const raw = typeof value === "number" ? value : Number(String(value).replace(",", "."));
  if (!Number.isFinite(raw)) return null;
  // Prozent- und 0..1-Angaben werden auf fünf Stufen abgebildet, nie gerundet verworfen.
  const scaled = unit === "percent" ? raw / 20 : raw > 0 && raw <= 1 ? raw * 5 : raw;
  return Math.min(5, Math.max(1, Math.round(scaled)));
}

/** Liest Risikozeilen aus einer Tabellen-Quelle. Ohne passende Spalten: leer. */
export function riskRowsFromSource(stored: StoredSource): SourceRiskRow[] {
  const dataset = stored.envelope.facets.dataset;
  if (!dataset) return [];
  const columns = riskColumns(dataset);
  if (!columns.chance && !columns.impact) return [];

  const sourceName = stored.envelope.meta.sourceName;
  return dataset.rows.map((row, index) => {
    const chance = columns.chance ? toLevel(row.values[columns.chance.key], columns.chance.unit) : null;
    const impact = columns.impact ? toLevel(row.values[columns.impact.key], columns.impact.unit) : null;
    const labelValue = columns.label ? row.values[columns.label.key] : null;
    const missing: string[] = [];
    if (chance == null) missing.push("Eintritt");
    if (impact == null) missing.push("Auswirkung");
    return {
      id: `${stored.envelope.id}:${row.index}`,
      label:
        labelValue == null || String(labelValue).trim() === ""
          ? `Zeile ${row.index}`
          : String(labelValue).trim(),
      chance,
      impact,
      row: row.index,
      sourceName,
      missing,
    };
  }).filter((item, index) => index < 200 && (item.chance != null || item.impact != null || item.label !== `Zeile ${item.row}`));
}

/* ------------------------------------------------------------------ */
/* Entscheidungsgrundlage                                              */
/* ------------------------------------------------------------------ */

function formatCell(value: unknown): string {
  if (value == null || value === "") return "—";
  return String(value);
}

function datasetBrief(dataset: TabularDataset, limit = 15): string[] {
  const head = dataset.columns.map((column) =>
    column.unit ? `${column.label} (${column.unit})` : column.label,
  );
  const lines = [`Spalten: ${head.join(" · ")}`, `Zeilen insgesamt: ${dataset.rowCount}`];
  const shown = dataset.rows.slice(0, limit);
  for (const row of shown) {
    const cells = dataset.columns.map((column) => `${column.label}: ${formatCell(row.values[column.key])}`);
    lines.push(`- Zeile ${row.index} — ${cells.join(", ")}`);
  }
  if (dataset.rowCount > shown.length) {
    lines.push(`- … ${dataset.rowCount - shown.length} weitere Zeilen liegen in der Quelle.`);
  }
  return lines;
}

/**
 * Klartext-Grundlage einer Quelle. Wird als Inhalt der Karte abgelegt und
 * fließt damit unverändert in Entscheidung (JEV) und Chat.
 */
export function sourceBrief(stored: StoredSource, findings: RuleFinding[] = []): string {
  const envelope: SourceEnvelope = stored.envelope;
  const { meta, quality, facets } = envelope;
  const parts: string[] = [];

  parts.push(
    [
      `Quelle: ${meta.sourceName}`,
      `Herkunft: ${meta.originKind} · Format: ${meta.format}${meta.container ? ` · ${meta.container}` : ""}`,
      `Aufgenommen: ${meta.ingestedAt} · Prüfsumme: ${meta.checksum}`,
      `Vollständigkeit ${Math.round(quality.completeness * 100)} % · Sicherheit ${Math.round(quality.confidence * 100)} %`,
    ].join("\n"),
  );

  if (facets.dataset) parts.push(datasetBrief(facets.dataset).join("\n"));
  if (facets.entity) {
    parts.push(
      `Struktur (${facets.entity.kind}):\n${JSON.stringify(facets.entity.data, null, 2).slice(0, 8000)}`,
    );
  }
  if (facets.document) parts.push(`Text:\n${facets.document.text.slice(0, 8000)}`);
  if (facets.evidence) {
    parts.push(
      `Beleg: ${facets.evidence.mediaType}, ${Math.round(facets.evidence.byteSize / 1024)} KB (Zeiger: ${facets.evidence.storageKey})`,
    );
  }

  if (quality.anomalies.length) {
    parts.push(`Unsicherheiten:\n${quality.anomalies.map((note) => `- ${note}`).join("\n")}`);
  }

  const relevant = findings.filter((item) => item.status !== "pass");
  if (relevant.length) {
    parts.push(
      `Regelbefunde (${relevant.length}):\n${relevant
        .map(
          (item) =>
            `- [${item.status === "violation" ? "Verstoß" : item.status === "warn" ? "Warnung" : "unbekannt"}] ${item.message}${item.row ? ` (Zeile ${item.row})` : ""}${item.reference ? ` — Grundlage: ${item.reference}` : ""}`,
        )
        .join("\n")}`,
    );
  }

  if (stored.truncated) {
    parts.push(`Hinweis: Auf der Karte liegt nur eine Vorschau; ${stored.truncated} Zeilen bleiben in der Datei.`);
  }

  return parts.join("\n\n");
}
