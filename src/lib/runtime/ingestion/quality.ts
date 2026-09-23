/**
 * Quality assessment: incompleteness is a measured fact, never an error.
 * Downstream logic can show a confidence signal instead of faking precision.
 */
import type {
  DataQuality,
  SourceFacets,
  TabularDataset,
} from "@/lib/runtime/source-protocol";

function round(value: number): number {
  return Math.max(0, Math.min(1, Math.round(value * 100) / 100));
}

function datasetQuality(dataset: TabularDataset): DataQuality {
  const anomalies: string[] = [];
  const cells = dataset.rowCount * dataset.columns.length;
  const filled = dataset.columns.reduce((sum, column) => sum + column.filled, 0);
  const completeness = cells ? filled / cells : 0;

  if (!dataset.rowCount) anomalies.push("Keine Datenzeilen gefunden.");
  for (const column of dataset.columns) {
    if (!column.total) continue;
    const share = column.filled / column.total;
    if (share < 0.6) {
      anomalies.push(`Spalte „${column.label}“ ist zu ${Math.round((1 - share) * 100)} % leer.`);
    }
  }
  const untyped = dataset.columns.filter((column) => column.type === "unknown").length;
  if (untyped) anomalies.push(`${untyped} Spalte(n) ohne erkennbaren Datentyp.`);

  const typed = dataset.columns.length - untyped;
  const typeConfidence = dataset.columns.length ? typed / dataset.columns.length : 0;
  const confidence = round(0.4 * completeness + 0.6 * typeConfidence);
  return { completeness: round(completeness), confidence, anomalies: anomalies.slice(0, 6) };
}

export function assessQuality(facets: SourceFacets): DataQuality {
  if (facets.dataset) return datasetQuality(facets.dataset);

  if (facets.entity) {
    const fields = facets.entity.schema;
    const empty = fields.filter((field) => field.type === "unknown").length;
    const completeness = fields.length ? round((fields.length - empty) / fields.length) : 0;
    const anomalies = empty ? [`${empty} Feld(er) ohne Wert.`] : [];
    if (!fields.length) anomalies.push("Struktur enthält keine Felder.");
    return { completeness, confidence: fields.length ? round(0.6 + 0.4 * completeness) : 0, anomalies };
  }

  if (facets.document) {
    const words = facets.document.wordCount;
    const completeness = words ? round(Math.min(1, words / 40)) : 0;
    return {
      completeness,
      confidence: words ? round(Math.min(1, 0.5 + words / 200)) : 0,
      anomalies: words ? [] : ["Text ist leer."],
    };
  }

  if (facets.evidence) {
    const ok = facets.evidence.byteSize > 0;
    return {
      completeness: ok ? 1 : 0,
      confidence: ok ? 0.8 : 0,
      anomalies: ok ? [] : ["Beleg ohne Inhalt."],
    };
  }

  return { completeness: 0, confidence: 0, anomalies: ["Quelle konnte nicht gelesen werden."] };
}
