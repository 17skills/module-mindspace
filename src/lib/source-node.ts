/**
 * Brücke zwischen der Aufnahme-Pipeline und einer Quellen-Karte auf dem Canvas.
 *
 * Auf der Karte liegen nur Metadaten und eine begrenzte Vorschau — niemals
 * große Binärdaten. Belege bleiben als Zeiger im Speicher.
 */
import type { NodeRecord } from "@/components/canvas/board-context";
import {
  describeEnvelope,
  type FacetName,
  type SourceEnvelope,
} from "@/lib/runtime/source-protocol";
import { ontologyFromEnvelope, type Ontology } from "@/lib/runtime/rule-ontology";

/** Zeilen, die auf der Karte mitgespeichert werden. Mehr bleibt in der Datei. */
export const STORED_ROWS = 200;

export interface StoredSource {
  envelope: SourceEnvelope;
  /** Zeilen, die aus Platzgründen nicht mitgespeichert wurden. */
  truncated: number;
}

/** Kappt die Zeilenmenge, bevor eine Quelle in der Karte landet. */
export function trimEnvelope(envelope: SourceEnvelope): StoredSource {
  const dataset = envelope.facets.dataset;
  if (!dataset || dataset.rows.length <= STORED_ROWS) return { envelope, truncated: 0 };
  return {
    envelope: {
      ...envelope,
      facets: { ...envelope.facets, dataset: { ...dataset, rows: dataset.rows.slice(0, STORED_ROWS) } },
    },
    truncated: dataset.rows.length - STORED_ROWS,
  };
}

export function readSource(record: NodeRecord | undefined | null): StoredSource | null {
  const meta = record?.metadata as { source?: StoredSource } | null | undefined;
  const stored = meta?.source;
  if (!stored?.envelope?.meta) return null;
  return stored;
}

/** Liest das Regelwerk einer Quelle — nur wenn die Struktur dem Schema entspricht. */
export function readOntology(record: NodeRecord | undefined | null): Ontology | null {
  const stored = readSource(record);
  if (!stored?.envelope.facets.entity) return null;
  return ontologyFromEnvelope(stored.envelope).ontology;
}

export const FACET_LABEL: Record<FacetName, string> = {
  dataset: "Tabelle",
  entity: "Struktur",
  document: "Text",
  evidence: "Beleg",
};

/** Kurzbeschreibung für die Kompaktansicht. */
export function sourceSummary(stored: StoredSource): string {
  const base = describeEnvelope(stored.envelope);
  return stored.truncated ? `${base} (Vorschau: erste ${STORED_ROWS})` : base;
}
