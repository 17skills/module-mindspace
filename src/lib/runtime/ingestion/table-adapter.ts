/**
 * Tabular ingestion: CSV/TSV text and OOXML workbooks (.xlsx/.xlsm).
 * Runs in the browser and on the edge — no native dependency, no upload step.
 */
import { strFromU8, unzipSync } from "fflate";
import type { ColumnSpec, DataRow, TabularDataset, ValueType } from "@/lib/runtime/source-protocol";
import { coerceValue, dominantType, semanticOf, unitOf } from "./typing";

/** Splits delimited text, honouring quoted fields and embedded newlines. */
export function parseDelimited(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]!;
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"') {
      quoted = true;
    } else if (char === delimiter) {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (char !== "\r") {
      field += char;
    }
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((entry) => entry.some((value) => value.trim() !== ""));
}

export function sniffDelimiter(text: string): string {
  const sample = text.split(/\r?\n/).filter(Boolean).slice(0, 5);
  let best = ",";
  let bestScore = 0;
  for (const delimiter of [";", ",", "\t", "|"]) {
    const counts = sample.map((line) => line.split(delimiter).length);
    const consistent = counts.length > 0 && counts.every((count) => count === counts[0]);
    const score = consistent ? (counts[0] ?? 0) : 0;
    if (score > bestScore) {
      best = delimiter;
      bestScore = score;
    }
  }
  return best;
}

function uniqueKey(label: string, used: Set<string>, index: number): string {
  const base =
    label
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9äöüß]+/g, "_")
      .replace(/^_|_$/g, "") || `spalte_${index + 1}`;
  let key = base;
  let suffix = 2;
  while (used.has(key)) {
    key = `${base}_${suffix}`;
    suffix += 1;
  }
  used.add(key);
  return key;
}

/** Turns a raw matrix (first row = header) into a typed dataset. */
export function buildDataset(matrix: string[][]): TabularDataset {
  if (!matrix.length) return { columns: [], rows: [], rowCount: 0 };

  const header = matrix[0]!;
  const body = matrix.slice(1);
  const used = new Set<string>();
  const labels = header.map((cell, index) => cell.trim() || `Spalte ${index + 1}`);
  const keys = labels.map((label, index) => uniqueKey(label, used, index));

  const typesPerColumn: ValueType[][] = keys.map(() => []);
  const filled = keys.map(() => 0);

  const rows: DataRow[] = body.map((cells, rowIndex) => {
    const values: Record<string, unknown> = {};
    keys.forEach((key, columnIndex) => {
      const { value, type } = coerceValue(cells[columnIndex] ?? null);
      values[key] = value;
      if (value != null) {
        filled[columnIndex] = (filled[columnIndex] ?? 0) + 1;
        typesPerColumn[columnIndex]!.push(type);
      }
    });
    // +2: row 1 is the header, spreadsheet rows are 1-based.
    return { index: rowIndex + 2, values };
  });

  const columns: ColumnSpec[] = keys.map((key, index) => {
    const label = labels[index]!;
    const type = dominantType(typesPerColumn[index]!);
    return {
      key,
      label,
      type,
      unit: unitOf(label, type),
      semantic: semanticOf(label),
      filled: filled[index] ?? 0,
      total: rows.length,
    };
  });

  return { columns, rows, rowCount: rows.length };
}

export function parseCsv(text: string, delimiter?: string): TabularDataset {
  const separator = delimiter ?? sniffDelimiter(text);
  return buildDataset(parseDelimited(text, separator));
}

/* ------------------------------ xlsx ------------------------------ */

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)))
    .replace(/&amp;/g, "&");
}

function sharedStringsOf(xml: string): string[] {
  return [...xml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((match) => {
    const parts = [...(match[1] ?? "").matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((part) =>
      decodeXmlEntities(part[1] ?? ""),
    );
    return parts.join("");
  });
}

function columnIndexOf(reference: string): number {
  const letters = /^([A-Z]+)/.exec(reference)?.[1] ?? "A";
  let index = 0;
  for (const letter of letters) index = index * 26 + (letter.charCodeAt(0) - 64);
  return index - 1;
}

/** Excel serial date → ISO date (1900 date system, incl. the 1900 leap bug). */
function serialToIso(serial: number): string | null {
  if (!Number.isFinite(serial) || serial < 1 || serial > 2958465) return null;
  const ms = Math.round((serial - 25569) * 86400 * 1000);
  const date = new Date(ms);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

export interface WorkbookSheet {
  name: string;
  matrix: string[][];
}

/** Reads every worksheet of an OOXML workbook into raw matrices. */
export function readWorkbook(bytes: Uint8Array): WorkbookSheet[] {
  const files = unzipSync(bytes);
  const shared = files["xl/sharedStrings.xml"]
    ? sharedStringsOf(strFromU8(files["xl/sharedStrings.xml"]))
    : [];

  const workbookXml = files["xl/workbook.xml"] ? strFromU8(files["xl/workbook.xml"]) : "";
  const names = [...workbookXml.matchAll(/<sheet[^>]*name="([^"]*)"[^>]*\/?>/g)].map((match) =>
    decodeXmlEntities(match[1] ?? ""),
  );

  const dateStyles = dateStyleIndexes(files);

  const sheetPaths = Object.keys(files)
    .filter((path) => /^xl\/worksheets\/sheet\d+\.xml$/.test(path))
    .sort(
      (a, b) =>
        Number(/sheet(\d+)\.xml$/.exec(a)?.[1] ?? 0) - Number(/sheet(\d+)\.xml$/.exec(b)?.[1] ?? 0),
    );

  return sheetPaths.map((path, index) => ({
    name: names[index] ?? `Tabelle ${index + 1}`,
    matrix: sheetMatrix(strFromU8(files[path]!), shared, dateStyles),
  }));
}

function dateStyleIndexes(files: Record<string, Uint8Array>): Set<number> {
  const styles = new Set<number>();
  const raw = files["xl/styles.xml"];
  if (!raw) return styles;
  const xml = strFromU8(raw);
  const customDateFormats = new Set<number>();
  for (const match of xml.matchAll(/<numFmt[^>]*numFmtId="(\d+)"[^>]*formatCode="([^"]*)"/g)) {
    const code = decodeXmlEntities(match[2] ?? "");
    if (/[dmy]/i.test(code) && !/[#0]/.test(code)) customDateFormats.add(Number(match[1]));
  }
  const builtinDates = new Set([14, 15, 16, 17, 22]);
  const cellXfs = /<cellXfs[\s\S]*?<\/cellXfs>/.exec(xml)?.[0] ?? "";
  [...cellXfs.matchAll(/<xf[^>]*numFmtId="(\d+)"[^>]*\/?>/g)].forEach((match, index) => {
    const id = Number(match[1]);
    if (builtinDates.has(id) || customDateFormats.has(id)) styles.add(index);
  });
  return styles;
}

function sheetMatrix(xml: string, shared: string[], dateStyles: Set<number>): string[][] {
  const matrix: string[][] = [];
  for (const rowMatch of xml.matchAll(/<row[^>]*r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells: string[] = [];
    for (const cellMatch of (rowMatch[2] ?? "").matchAll(/<c([^>]*)>([\s\S]*?)<\/c>/g)) {
      const attributes = cellMatch[1] ?? "";
      const body = cellMatch[2] ?? "";
      const reference = /r="([A-Z]+\d+)"/.exec(attributes)?.[1] ?? "";
      const type = /t="([^"]+)"/.exec(attributes)?.[1] ?? "n";
      const styleIndex = Number(/s="(\d+)"/.exec(attributes)?.[1] ?? -1);
      const rawValue = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1] ?? "";
      const inline = [...body.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)]
        .map((part) => decodeXmlEntities(part[1] ?? ""))
        .join("");

      let value: string;
      if (type === "s") value = shared[Number(rawValue)] ?? "";
      else if (type === "inlineStr") value = inline;
      else if (type === "b") value = rawValue === "1" ? "true" : "false";
      else if (dateStyles.has(styleIndex)) value = serialToIso(Number(rawValue)) ?? rawValue;
      else value = decodeXmlEntities(rawValue || inline);

      const index = reference ? columnIndexOf(reference) : cells.length;
      while (cells.length < index) cells.push("");
      cells[index] = value;
    }
    matrix.push(cells);
  }
  return matrix.filter((row) => row.some((cell) => cell.trim() !== ""));
}

/** First non-empty worksheet as a typed dataset. */
export function parseWorkbook(bytes: Uint8Array): { sheet: string; dataset: TabularDataset } {
  const sheets = readWorkbook(bytes);
  const sheet = sheets.find((entry) => entry.matrix.length > 1) ?? sheets[0];
  return {
    sheet: sheet?.name ?? "Tabelle 1",
    dataset: buildDataset(sheet?.matrix ?? []),
  };
}

/** Rows coming from an API/MCP response (array of objects). */
export function datasetFromObjects(records: Array<Record<string, unknown>>): TabularDataset {
  if (!records.length) return { columns: [], rows: [], rowCount: 0 };
  const keys: string[] = [];
  for (const record of records) {
    for (const key of Object.keys(record)) if (!keys.includes(key)) keys.push(key);
  }
  const matrix: string[][] = [keys];
  for (const record of records) {
    matrix.push(
      keys.map((key) => {
        const value = record[key];
        if (value == null) return "";
        if (typeof value === "object") return JSON.stringify(value);
        return String(value);
      }),
    );
  }
  return buildDataset(matrix);
}
