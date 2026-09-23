/**
 * The single ingestion pipeline.
 *
 *   RawInput → sniffer → adapter → quality → SourceEnvelope
 *
 * A source is a source is a source: every input runs the same route and
 * leaves as the same envelope. New formats plug in as one more adapter;
 * nothing downstream changes.
 */
import {
  assessQuality,
} from "./quality";
import { detectFormat } from "./sniffer";
import { buildDocument } from "./document-adapter";
import { buildEntity, parseJson, parseYaml } from "./entity-adapter";
import { datasetFromObjects, parseCsv, parseWorkbook } from "./table-adapter";
import {
  checksum,
  collectSemantics,
  type BinaryArtifactRef,
  type SourceEnvelope,
  type SourceFacets,
  type SourceFormat,
  type SourceOriginKind,
} from "@/lib/runtime/source-protocol";

export interface IngestOptions {
  /** Name shown to the user: file name, endpoint, "Notiz". */
  sourceName: string;
  originKind?: SourceOriginKind;
  mediaType?: string | null;
  /** Sheet, endpoint or section the payload came from. */
  container?: string | null;
  id?: string;
  ingestedAt?: string;
}

function envelopeOf(
  facets: SourceFacets,
  format: SourceFormat,
  content: string,
  options: IngestOptions,
  container: string | null,
): SourceEnvelope {
  return {
    id: options.id ?? `src_${checksum(`${options.sourceName}:${content}`)}`,
    meta: {
      originKind: options.originKind ?? "file",
      sourceName: options.sourceName,
      format,
      mediaType: options.mediaType ?? null,
      checksum: checksum(content),
      ingestedAt: options.ingestedAt ?? new Date().toISOString(),
      container: options.container ?? container,
    },
    facets,
    quality: assessQuality(facets),
    semantics: collectSemantics(facets),
  };
}

/** Text based input of any format. */
export function ingestText(text: string, options: IngestOptions): SourceEnvelope {
  const format = detectFormat({
    name: options.sourceName,
    mediaType: options.mediaType,
    text,
  });
  let facets: SourceFacets;

  try {
    switch (format) {
      case "csv":
        facets = { dataset: parseCsv(text) };
        break;
      case "tsv":
        facets = { dataset: parseCsv(text, "\t") };
        break;
      case "json":
        facets = facetsFromJson(text);
        break;
      case "yaml":
        facets = { entity: parseYaml(text) };
        break;
      default:
        facets = { document: buildDocument(text) };
    }
  } catch {
    // A broken structure never blocks ingestion — it degrades to text.
    facets = { document: buildDocument(text) };
  }

  return envelopeOf(facets, format, text, options, null);
}

function facetsFromJson(text: string): SourceFacets {
  const value: unknown = JSON.parse(text);
  if (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((row) => row && typeof row === "object" && !Array.isArray(row))
  ) {
    return { dataset: datasetFromObjects(value as Array<Record<string, unknown>>) };
  }
  return { entity: parseJson(text) };
}

/** Binary input: workbooks are parsed, images/blobs stay a storage pointer. */
export function ingestBytes(
  bytes: Uint8Array,
  options: IngestOptions & { storageKey?: string },
): SourceEnvelope {
  const format = detectFormat({
    name: options.sourceName,
    mediaType: options.mediaType,
    bytes,
  });

  if (format === "xlsx") {
    const { sheet, dataset } = parseWorkbook(bytes);
    return envelopeOf(
      { dataset },
      "xlsx",
      `${options.sourceName}:${bytes.byteLength}:${dataset.rowCount}`,
      options,
      sheet,
    );
  }

  if (format === "image" || format === "binary") {
    const evidence: BinaryArtifactRef = {
      storageKey: options.storageKey ?? "",
      mediaType: options.mediaType ?? (format === "image" ? "image/*" : "application/octet-stream"),
      byteSize: bytes.byteLength,
      width: null,
      height: null,
      capturedAt: null,
    };
    return envelopeOf(
      { evidence },
      format,
      `${options.sourceName}:${bytes.byteLength}`,
      options,
      null,
    );
  }

  return ingestText(new TextDecoder().decode(bytes), options);
}

/** Browser drop: one call for every file the user throws on the canvas. */
export async function ingestFile(
  file: File,
  options?: Partial<IngestOptions> & { storageKey?: string },
): Promise<SourceEnvelope> {
  const base: IngestOptions & { storageKey?: string } = {
    sourceName: options?.sourceName ?? file.name,
    originKind: options?.originKind ?? "file",
    mediaType: options?.mediaType ?? file.type ?? null,
    container: options?.container ?? null,
    id: options?.id,
    ingestedAt: options?.ingestedAt,
    storageKey: options?.storageKey,
  };
  const bytes = new Uint8Array(await file.arrayBuffer());
  return ingestBytes(bytes, base);
}

/** API/MCP/sensor payload that is already decoded JSON. */
export function ingestValue(value: unknown, options: IngestOptions): SourceEnvelope {
  const text = JSON.stringify(value ?? null);
  const facets: SourceFacets =
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((row) => row && typeof row === "object" && !Array.isArray(row))
      ? { dataset: datasetFromObjects(value as Array<Record<string, unknown>>) }
      : typeof value === "string"
        ? { document: buildDocument(value) }
        : { entity: buildEntity(value) };

  return envelopeOf(
    facets,
    "json",
    text,
    { ...options, originKind: options.originKind ?? "stream" },
    null,
  );
}

/** Stored evidence (photo, scan) that lives in object storage. */
export function ingestEvidence(
  artifact: BinaryArtifactRef,
  options: IngestOptions,
): SourceEnvelope {
  return envelopeOf(
    { evidence: artifact },
    "image",
    `${artifact.storageKey}:${artifact.byteSize}`,
    { ...options, originKind: options.originKind ?? "file" },
    null,
  );
}

export { detectFormat } from "./sniffer";
export { assessQuality } from "./quality";
export { parseCsv, parseWorkbook, readWorkbook, datasetFromObjects } from "./table-adapter";
export { parseYaml, parseJson, buildEntity } from "./entity-adapter";
export { buildDocument } from "./document-adapter";
