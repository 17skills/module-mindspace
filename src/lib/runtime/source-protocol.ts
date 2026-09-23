/**
 * Unified Source Protocol.
 *
 * Every piece of incoming information — spreadsheet, CSV, YAML role, JSON
 * config, note, photo, API/MCP response — leaves ingestion as the SAME
 * envelope. The envelope never bends data into a foreign shape: it carries
 * typed facets, so a consumer picks the facet it understands.
 *
 * Invariants:
 *  - origin and lineage are immutable and always present
 *  - incompleteness is a first class value (quality), never an error
 *  - no facet is privileged; a source is a source is a source
 */

export type SourceOriginKind = "file" | "text" | "stream" | "sensor" | "manual";

/** Physical shape recognised by the sniffer; adapters map it onto facets. */
export type SourceFormat =
  | "xlsx"
  | "csv"
  | "tsv"
  | "json"
  | "yaml"
  | "markdown"
  | "text"
  | "image"
  | "binary";

/** Where a value came from — kept for audit and revision. */
export interface SourceLineage {
  originKind: SourceOriginKind;
  /** File name, stream name or "Notiz" — shown to the user verbatim. */
  sourceName: string;
  format: SourceFormat;
  mediaType: string | null;
  /** Stable content hash; identical input yields an identical checksum. */
  checksum: string;
  ingestedAt: string;
  /** Sheet, endpoint or section the payload was taken from. */
  container: string | null;
}

/** Pointer back to the exact origin of a single value. */
export interface CellLineage {
  sourceId: string;
  sourceName: string;
  container: string | null;
  row: number | null;
  column: string | null;
}

export type ValueType = "number" | "text" | "boolean" | "date" | "unknown";

/** Units stay explicit; no implicit conversion ever happens. */
export type Unit =
  | "EUR"
  | "kEUR"
  | "percent"
  | "bar"
  | "celsius"
  | "hours"
  | "days"
  | "count"
  | "score";

/** Light, flat vocabulary — deliberately not a rigid corporate ontology. */
export type SemanticTag =
  | "amount"
  | "probability"
  | "severity"
  | "priority"
  | "date"
  | "status"
  | "identifier"
  | "location"
  | "role"
  | "rule"
  | "measurement"
  | "text";

export interface ColumnSpec {
  key: string;
  label: string;
  type: ValueType;
  unit: Unit | null;
  semantic: SemanticTag | null;
  /** Filled cells of this column, used for the completeness signal. */
  filled: number;
  total: number;
}

export interface DataRow {
  /** 1-based row number in the original source, for lineage. */
  index: number;
  values: Record<string, unknown>;
}

/** Facet for anything with rows and columns: sheets, CSV, query results. */
export interface TabularDataset {
  columns: ColumnSpec[];
  rows: DataRow[];
  rowCount: number;
}

export interface FieldSpec {
  path: string;
  type: ValueType | "object" | "list";
  semantic: SemanticTag | null;
}

/** Facet for hierarchical, declarative content: roles, rules, configuration. */
export interface StructuredEntity {
  /** Free label such as "role", "policy", "config" — heuristically derived. */
  kind: string;
  schema: FieldSpec[];
  data: Record<string, unknown>;
}

export interface TextSection {
  heading: string | null;
  body: string;
}

/** Facet for free text: notes, markdown, transcripts, mail bodies. */
export interface UnstructuredText {
  text: string;
  sections: TextSection[];
  wordCount: number;
}

/** Facet for binary evidence — the blob stays in storage, never on the canvas. */
export interface BinaryArtifactRef {
  storageKey: string;
  mediaType: string;
  byteSize: number;
  width: number | null;
  height: number | null;
  capturedAt: string | null;
}

export interface DataQuality {
  /** Share of filled values, 0..1. */
  completeness: number;
  /** How much the interpretation can be trusted, 0..1. */
  confidence: number;
  /** Plain-language notes, e.g. "Spalte „Schaden“ zu 40 % leer". */
  anomalies: string[];
}

export interface SourceFacets {
  dataset?: TabularDataset;
  entity?: StructuredEntity;
  document?: UnstructuredText;
  evidence?: BinaryArtifactRef;
}

export interface SourceEnvelope {
  id: string;
  meta: SourceLineage;
  facets: SourceFacets;
  quality: DataQuality;
  semantics: SemanticTag[];
}

export type FacetName = keyof SourceFacets;

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

/** Deterministic 64-bit FNV-1a content hash, stable across runtimes. */
export function checksum(input: string): string {
  let hi = 0x811c9dc5;
  let lo = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    const code = input.charCodeAt(i);
    hi = Math.imul(hi ^ code, 0x01000193) >>> 0;
    lo = Math.imul(lo ^ ((code << 3) | i % 7), 0x01000193) >>> 0;
  }
  return hi.toString(16).padStart(8, "0") + lo.toString(16).padStart(8, "0");
}

export function hasFacet(envelope: SourceEnvelope, facet: FacetName): boolean {
  return envelope.facets[facet] != null;
}

/** Order of preference when a consumer accepts anything. */
const FACET_ORDER: FacetName[] = ["dataset", "entity", "document", "evidence"];

export function primaryFacet(envelope: SourceEnvelope): FacetName | null {
  return FACET_ORDER.find((facet) => envelope.facets[facet] != null) ?? null;
}

/** Lineage pointer for one value — answers "where exactly did this come from". */
export function cellLineage(
  envelope: SourceEnvelope,
  row: number | null = null,
  column: string | null = null,
): CellLineage {
  return {
    sourceId: envelope.id,
    sourceName: envelope.meta.sourceName,
    container: envelope.meta.container,
    row,
    column,
  };
}

export type SourceSignal = "ok" | "warn" | "error" | "idle";

/**
 * Traffic light of a source. A source with gaps warns, it never fails —
 * only an envelope without any usable facet is red.
 */
export function envelopeSignal(envelope: SourceEnvelope): SourceSignal {
  if (!primaryFacet(envelope)) return "error";
  const { completeness, confidence } = envelope.quality;
  if (completeness >= 0.95 && confidence >= 0.8) return "ok";
  if (completeness >= 0.5 || confidence >= 0.5) return "warn";
  return "idle";
}

/** Short German summary shown on the compact card. */
export function describeEnvelope(envelope: SourceEnvelope): string {
  const { dataset, entity, document, evidence } = envelope.facets;
  if (dataset) return `${dataset.rowCount} Zeilen, ${dataset.columns.length} Spalten`;
  if (entity) return `${entity.kind}, ${entity.schema.length} Felder`;
  if (document) return `Text, ${document.wordCount} Wörter`;
  if (evidence) return `Beleg, ${Math.round(evidence.byteSize / 1024)} KB`;
  return "Keine auswertbaren Inhalte";
}

/** Collects the distinct semantic tags across all facets. */
export function collectSemantics(facets: SourceFacets): SemanticTag[] {
  const tags = new Set<SemanticTag>();
  facets.dataset?.columns.forEach((column) => {
    if (column.semantic) tags.add(column.semantic);
  });
  facets.entity?.schema.forEach((field) => {
    if (field.semantic) tags.add(field.semantic);
  });
  if (facets.document) tags.add("text");
  return [...tags];
}
