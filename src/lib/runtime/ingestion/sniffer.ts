/**
 * Format detection for the ingestion pipeline.
 * Deterministic: magic bytes first, then media type, then file extension,
 * then a content heuristic. No guessing of meaning happens here.
 */
import type { SourceFormat } from "@/lib/runtime/source-protocol";

export interface SniffInput {
  name?: string;
  mediaType?: string | null | undefined;
  bytes?: Uint8Array;
  text?: string;
}

const EXTENSIONS: Record<string, SourceFormat> = {
  xlsx: "xlsx",
  xlsm: "xlsx",
  xls: "xlsx",
  csv: "csv",
  tsv: "tsv",
  json: "json",
  yaml: "yaml",
  yml: "yaml",
  md: "markdown",
  markdown: "markdown",
  txt: "text",
  log: "text",
  png: "image",
  jpg: "image",
  jpeg: "image",
  webp: "image",
  heic: "image",
  gif: "image",
};

function byMagic(bytes: Uint8Array | undefined): SourceFormat | null {
  if (!bytes || bytes.length < 4) return null;
  const [a, b, c, d] = [bytes[0], bytes[1], bytes[2], bytes[3]];
  // ZIP container → OOXML workbook (xlsx/xlsm)
  if (a === 0x50 && b === 0x4b && (c === 0x03 || c === 0x05 || c === 0x07)) return "xlsx";
  // Legacy OLE2 .xls
  if (a === 0xd0 && b === 0xcf && c === 0x11 && d === 0xe0) return "binary";
  if (a === 0x89 && b === 0x50 && c === 0x4e && d === 0x47) return "image";
  if (a === 0xff && b === 0xd8 && c === 0xff) return "image";
  if (a === 0x47 && b === 0x49 && c === 0x46) return "image";
  return null;
}

function byMediaType(mediaType: string | null | undefined): SourceFormat | null {
  if (!mediaType) return null;
  const type = mediaType.toLowerCase();
  if (type.includes("spreadsheet") || type.includes("excel")) return "xlsx";
  if (type.includes("csv")) return "csv";
  if (type.includes("tab-separated")) return "tsv";
  if (type.includes("json")) return "json";
  if (type.includes("yaml")) return "yaml";
  if (type.includes("markdown")) return "markdown";
  if (type.startsWith("image/")) return "image";
  if (type.startsWith("text/")) return "text";
  return null;
}

function byExtension(name: string | undefined): SourceFormat | null {
  if (!name) return null;
  const extension = name.toLowerCase().split(".").pop();
  return extension ? (EXTENSIONS[extension] ?? null) : null;
}

/** Content heuristic for pasted text without a name or media type. */
export function sniffText(text: string): SourceFormat {
  const trimmed = text.trim();
  if (!trimmed) return "text";
  if (/^[[{]/.test(trimmed)) {
    try {
      JSON.parse(trimmed);
      return "json";
    } catch {
      /* fall through */
    }
  }
  if (/^(---\s*$|[A-Za-z0-9_-]+:\s)/m.test(trimmed) && !/^#{1,6}\s/m.test(trimmed)) {
    const yamlLines = trimmed
      .split("\n")
      .filter((line) => /^\s*[-A-Za-z0-9_ .]+:\s?/.test(line)).length;
    if (yamlLines >= 2) return "yaml";
  }
  if (/^#{1,6}\s/m.test(trimmed) || /^[-*]\s/m.test(trimmed)) return "markdown";

  const lines = trimmed.split(/\r?\n/).filter(Boolean).slice(0, 10);
  if (lines.length >= 2) {
    for (const delimiter of [";", ",", "\t"] as const) {
      const counts = lines.map((line) => line.split(delimiter).length);
      if (counts[0]! > 1 && counts.every((count) => count === counts[0])) {
        return delimiter === "\t" ? "tsv" : "csv";
      }
    }
  }
  return "text";
}

export function detectFormat(input: SniffInput): SourceFormat {
  return (
    byMagic(input.bytes) ??
    byMediaType(input.mediaType) ??
    byExtension(input.name) ??
    (input.text != null ? sniffText(input.text) : "binary")
  );
}
