import type { Edge } from "@xyflow/react";
import type { NodeRecord } from "@/components/canvas/board-context";
import { apiValue, decisionValue } from "@/lib/api-module";
import { readFactor } from "@/lib/factor-score";
import { readInspection } from "@/lib/inspection";
import {
  maxRisk,
  pointsFromSources,
  readMapConfig,
  readRiskConfig,
  riskEntries,
} from "@/lib/geo";

function toNumber(raw: unknown): number | null {
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string") {
    const parsed = Number(raw.replace(/\s/g, "").replace(/\.(?=\d{3}\b)/g, "").replace(",", "."));
    if (Number.isFinite(parsed) && raw.trim() !== "") return parsed;
  }
  return null;
}

/** Numeric value a module contributes to calculations (metadata.value). */
export function nodeValue(record: NodeRecord | undefined): number | null {
  if (!record) return null;
  // a background field contributes the result of its agent
  if (record.type === "zone") return toNumber(record.metadata?.["agentResult"]);
  if (record.type === "sheet") return sheetResult(record);
  if (record.type === "api") return apiValue(record);
  if (record.type === "decision") return decisionValue(record);
  // a weighted factor card sends its card score (1..10) into the network
  if (record.type === "note") {
    const factor = readFactor(record);
    if (factor.stored && factor.params.length) return factor.score;
  }
  // an inspection module sends the count of immediate findings (priority 1..3)
  if (record.type === "inspect") {
    return readInspection(record).findings.filter(
      (finding) => finding.priority <= 3,
    ).length;
  }
  return toNumber(record.metadata?.["value"]);
}

/**
 * Turns an edge label into a factor/override applied to the source value.
 * "25%" → 25 % of the source value, "2500" → fixed 2500, empty → source value,
 * "x * 0.75" / "x - 100" → formula where x is the source value.
 */
export function edgeValue(label: string | null | undefined, sourceValue: number | null): number | null {
  const text = (label ?? "").trim();
  if (!text) return sourceValue;
  const percent = text.match(/^(-?\d+(?:[.,]\d+)?)\s*%$/);
  if (percent) {
    if (sourceValue == null) return null;
    return (sourceValue * Number(percent[1]!.replace(",", "."))) / 100;
  }
  const fixed = text.match(/^-?\d+(?:[.,]\d+)?$/);
  if (fixed) return Number(text.replace(",", "."));
  // formula with x = source value, e.g. "x * 0.75" or "x - 100"
  if (/x/i.test(text) && /^[\dxX\s+\-*/%.,()]+$/.test(text)) {
    if (sourceValue == null) return null;
    return evalFormula(text, { X: sourceValue });
  }
  return sourceValue;
}


export type CalcInput = {
  letter: string;
  edgeId: string;
  sourceId: string;
  title: string;
  /** Resolved value after applying the edge label. */
  value: number | null;
  /** Raw source value before the edge label. */
  raw: number | null;
  label: string | null;
};

const LETTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ";

/** Incoming values of a calculation module, letters assigned in stable order. */
export function calcInputs(
  calcId: string,
  records: Record<string, NodeRecord>,
  edges: Edge[],
  depth = 0,
): CalcInput[] {
  const incoming = edges
    .filter((e) => e.target === calcId)
    .sort((a, b) => a.id.localeCompare(b.id));
  return incoming.map((edge, index) => {
    const source = records[edge.source];
    const raw = source ? valueOfNode(source, records, edges, depth + 1) : null;
    const label = typeof edge.label === "string" ? edge.label : null;
    return {
      letter: LETTERS[index] ?? `V${index + 1}`,
      edgeId: edge.id,
      sourceId: edge.source,
      title: source?.title ?? "Modul",
      value: edgeValue(label, raw),
      raw,
      label,
    };
  });
}

/** Value of any module; calculation modules resolve their formula recursively. */
export function valueOfNode(
  record: NodeRecord,
  records: Record<string, NodeRecord>,
  edges: Edge[],
  depth = 0,
): number | null {
  if (depth > 8) return nodeValue(record);
  // metric/gauge mirror the first incoming value when connected
  if (record.type === "metric" || record.type === "gauge") {
    const inputs = calcInputs(record.id, records, edges, depth);
    const linked = inputs.find((input) => input.value != null);
    return linked?.value ?? nodeValue(record);
  }
  // map: number of objects with heavy rain; risk: highest risk level
  if (record.type === "map" || record.type === "risk") {
    const maps =
      record.type === "map"
        ? [record]
        : Object.values(records).filter((item) => item.type === "map");
    let risky = 0;
    const entries = [];
    for (const mapRecord of maps) {
      const mapConfig = readMapConfig(mapRecord);
      const sources = edges
        .filter((edge) => edge.target === mapRecord.id || edge.source === mapRecord.id)
        .map((edge) => records[edge.target === mapRecord.id ? edge.source : edge.target])
        .filter((item): item is NodeRecord => Boolean(item));
      const points = pointsFromSources(sources, mapConfig);
      risky += points.filter((point) => (mapConfig.weather[point.id]?.rain ?? 0) >= 10).length;
      entries.push(...riskEntries(points, mapConfig.weather, readRiskConfig(record)));
    }
    return record.type === "map" ? risky : maxRisk(entries);
  }
  if (record.type !== "calc") return nodeValue(record);
  const formula = typeof record.metadata?.["formula"] === "string" ? record.metadata["formula"] : "";
  if (!formula.trim()) return nodeValue(record);

  const inputs = calcInputs(record.id, records, edges, depth);
  const vars: Record<string, number> = {};
  for (const input of inputs) {
    if (input.value != null) vars[input.letter] = input.value;
  }
  return evalFormula(formula, vars);
}

/**
 * Safe formula evaluator: numbers, variable letters, + - * / ( ) and %.
 * Returns null for anything invalid — never throws, never evals.
 */
export function evalFormula(expr: string, vars: Record<string, number>): number | null {
  const tokens = tokenize(expr);
  if (!tokens) return null;

  // shunting-yard → RPN
  const output: (number | string)[] = [];
  const ops: string[] = [];
  const prec: Record<string, number> = { "+": 1, "-": 1, "*": 2, "/": 2, "%": 2, u: 3 };
  let prev: string | null = null;
  for (const token of tokens) {
    if (typeof token === "number") {
      output.push(token);
      prev = "num";
    } else if (/^[A-Z][A-Z0-9]*$/.test(token)) {
      const value = vars[token];
      if (value == null) return null;
      output.push(value);
      prev = "num";
    } else if (token === "(") {
      ops.push(token);
      prev = "(";
    } else if (token === ")") {
      while (ops.length && ops[ops.length - 1] !== "(") output.push(ops.pop()!);
      if (!ops.length) return null;
      ops.pop();
      prev = "num";
    } else {
      let op = token;
      if (op === "-" && (prev === null || prev === "(" || prev === "op")) op = "u";
      while (
        ops.length &&
        ops[ops.length - 1] !== "(" &&
        (prec[ops[ops.length - 1]!] ?? 0) >= (prec[op] ?? 0)
      ) {
        output.push(ops.pop()!);
      }
      ops.push(op);
      prev = "op";
    }
  }
  while (ops.length) {
    const op = ops.pop()!;
    if (op === "(") return null;
    output.push(op);
  }

  // evaluate RPN
  const stack: number[] = [];
  for (const token of output) {
    if (typeof token === "number") {
      stack.push(token);
    } else if (token === "u") {
      const a = stack.pop();
      if (a == null) return null;
      stack.push(-a);
    } else {
      const b = stack.pop();
      const a = stack.pop();
      if (a == null || b == null) return null;
      if (token === "+") stack.push(a + b);
      else if (token === "-") stack.push(a - b);
      else if (token === "*") stack.push(a * b);
      else if (token === "%") stack.push(a % b);
      else if (token === "/") {
        if (b === 0) return null;
        stack.push(a / b);
      } else return null;
    }
  }
  return stack.length === 1 ? stack[0]! : null;
}

function tokenize(expr: string): (number | string)[] | null {
  const tokens: (number | string)[] = [];
  let i = 0;
  const text = expr.replace(/,/g, ".");
  while (i < text.length) {
    const ch = text[i]!;
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    const num = text.slice(i).match(/^\d+(?:\.\d+)?/);
    if (num) {
      tokens.push(Number(num[0]));
      i += num[0].length;
      continue;
    }
    const name = text.slice(i).match(/^[A-Za-z][A-Za-z0-9]*/);
    if (name) {
      tokens.push(name[0].toUpperCase());
      i += name[0].length;
      continue;
    }
    if ("+-*/%()".includes(ch)) {
      tokens.push(ch);
      i++;
      continue;
    }
    return null;
  }
  return tokens.length ? tokens : null;
}

/** Per-module number formatting (metadata.numFormat). */
export type ValueFormat = { decimals: number | null; prefix: string; suffix: string };

/** Read the format settings of a module from its metadata. */
export function readFormat(meta: Record<string, unknown> | null | undefined): ValueFormat {
  const raw = (meta?.["numFormat"] ?? {}) as Record<string, unknown>;
  const decimalsRaw = raw["decimals"];
  return {
    decimals: typeof decimalsRaw === "number" && Number.isFinite(decimalsRaw) ? decimalsRaw : null,
    prefix: typeof raw["prefix"] === "string" ? raw["prefix"] : "",
    suffix: typeof raw["suffix"] === "string" ? raw["suffix"] : "",
  };
}

/** German number formatting for results, with optional decimals/prefix/suffix. */
export function formatValue(value: number | null, fmt?: ValueFormat): string {
  if (value == null) return "–";
  const decimals = fmt?.decimals ?? null;
  const body =
    decimals != null
      ? value.toLocaleString("de-DE", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
      : (Math.round(value * 100) / 100).toLocaleString("de-DE", { maximumFractionDigits: 2 });
  const prefix = fmt?.prefix ?? "";
  const suffix = fmt?.suffix ?? "";
  // keep word-like prefixes/suffixes readable ("Euro 100.000", not "Euro100.000")
  const pre = prefix ? `${prefix}${/[\p{L}\d]$/u.test(prefix) ? " " : ""}` : "";
  const suf = suffix ? `${/^[\p{L}\d]/u.test(suffix) ? " " : ""}${suffix}` : "";
  return `${pre}${body}${suf}`;
}

export type SheetRow = { name: string; value: string; formula: string };

/** Rows of a sheet module (metadata.rows). */
export function sheetRows(record: NodeRecord | undefined | null): SheetRow[] {
  const raw = record?.metadata?.["rows"];
  if (!Array.isArray(raw)) return [];
  return raw.map((item) => {
    const row = (item ?? {}) as Record<string, unknown>;
    return {
      name: typeof row["name"] === "string" ? row["name"] : "",
      value: typeof row["value"] === "string" ? row["value"] : "",
      formula: typeof row["formula"] === "string" ? row["formula"] : "",
    };
  });
}

/**
 * Resolve every row of a sheet. Rows reference each other as R1, R2 …
 * and incoming modules by their letter (A, B …) through `extra`.
 */
export function sheetValues(
  record: NodeRecord | undefined | null,
  extra: Record<string, number> = {},
): (number | null)[] {
  const rows = sheetRows(record);
  const values: (number | null)[] = rows.map((row) =>
    row.formula.trim() ? null : Number(row.value.replace(",", ".")) || (row.value.trim() ? null : null),
  );
  rows.forEach((row, index) => {
    if (row.formula.trim()) return;
    const parsed = Number(row.value.replace(",", "."));
    values[index] = row.value.trim() && Number.isFinite(parsed) ? parsed : null;
  });
  // repeated passes resolve chains; the loop count caps cycles
  for (let pass = 0; pass < rows.length + 1; pass++) {
    rows.forEach((row, index) => {
      if (!row.formula.trim() || values[index] != null) return;
      const vars: Record<string, number> = { ...extra };
      values.forEach((value, other) => {
        if (value != null) vars[`R${other + 1}`] = value;
      });
      values[index] = evalFormula(row.formula, vars);
    });
  }
  return values;
}

/** Index of the row a sheet passes on (metadata.outputRow), if set. */
export function sheetOutputRow(record: NodeRecord | undefined | null): number | null {
  const raw = record?.metadata?.["outputRow"];
  return typeof raw === "number" && Number.isInteger(raw) && raw >= 0 ? raw : null;
}

/** Result of a sheet: the chosen row, otherwise the last row that resolves. */
export function sheetResult(record: NodeRecord | undefined | null): number | null {
  const values = sheetValues(record);
  const chosen = sheetOutputRow(record);
  if (chosen != null) return values[chosen] ?? null;
  for (let i = values.length - 1; i >= 0; i--) {
    const value = values[i];
    if (value != null) return value;
  }
  return null;
}
