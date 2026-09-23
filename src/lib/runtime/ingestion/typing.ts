/**
 * Zero-config value typing and light semantic tagging.
 * Heuristics only — they never overwrite an explicit user mapping.
 */
import type { SemanticTag, Unit, ValueType } from "@/lib/runtime/source-protocol";

const TRUE_WORDS = new Set(["true", "ja", "yes", "wahr", "x", "1"]);
const FALSE_WORDS = new Set(["false", "nein", "no", "falsch", "0"]);

const ISO_DATE = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2})?)?/;
const DE_DATE = /^(\d{1,2})\.(\d{1,2})\.(\d{2,4})$/;

/** Parses German and English number notation without losing precision. */
export function parseNumber(raw: string): number | null {
  const text = raw
    .trim()
    .replace(/[\u00a0\s]/g, "")
    .replace(/[€$£]/g, "")
    .replace(/%$/, "");
  if (!text || !/[0-9]/.test(text)) return null;
  if (!/^[-+]?[0-9.,]+(?:[eE][-+]?\d+)?$/.test(text)) return null;

  const lastComma = text.lastIndexOf(",");
  const lastDot = text.lastIndexOf(".");
  let normalised = text;
  if (lastComma > -1 && lastDot > -1) {
    normalised =
      lastComma > lastDot
        ? text.replace(/\./g, "").replace(",", ".")
        : text.replace(/,/g, "");
  } else if (lastComma > -1) {
    const decimals = text.length - lastComma - 1;
    normalised = decimals === 3 && /^\d{1,3}(,\d{3})+$/.test(text)
      ? text.replace(/,/g, "")
      : text.replace(",", ".");
  } else if (lastDot > -1 && /^\d{1,3}(\.\d{3})+$/.test(text)) {
    normalised = text.replace(/\./g, "");
  }
  const value = Number(normalised);
  return Number.isFinite(value) ? value : null;
}

export function parseDate(raw: string): string | null {
  const text = raw.trim();
  if (ISO_DATE.test(text)) return text;
  const match = DE_DATE.exec(text);
  if (match) {
    const [, day, month, year] = match;
    const full = year!.length === 2 ? `20${year}` : year!;
    return `${full}-${month!.padStart(2, "0")}-${day!.padStart(2, "0")}`;
  }
  return null;
}

/** Turns a raw cell into a typed value; empty stays null (a real gap). */
export function coerceValue(raw: unknown): { value: unknown; type: ValueType } {
  if (raw == null) return { value: null, type: "unknown" };
  if (typeof raw === "number") {
    return { value: Number.isFinite(raw) ? raw : null, type: "number" };
  }
  if (typeof raw === "boolean") return { value: raw, type: "boolean" };
  const text = String(raw).trim();
  if (!text || text === "-" || text === "–" || text.toLowerCase() === "n/a") {
    return { value: null, type: "unknown" };
  }
  const date = parseDate(text);
  if (date) return { value: date, type: "date" };
  const number = parseNumber(text);
  if (number != null) return { value: number, type: "number" };
  const lower = text.toLowerCase();
  if (TRUE_WORDS.has(lower) && lower !== "1" && lower !== "x") {
    return { value: true, type: "boolean" };
  }
  if (FALSE_WORDS.has(lower) && lower !== "0") return { value: false, type: "boolean" };
  return { value: text, type: "text" };
}

/** Majority type of a column; text wins over mixed content. */
export function dominantType(types: ValueType[]): ValueType {
  const counts = new Map<ValueType, number>();
  for (const type of types) {
    if (type === "unknown") continue;
    counts.set(type, (counts.get(type) ?? 0) + 1);
  }
  if (!counts.size) return "unknown";
  let best: ValueType = "text";
  let bestCount = -1;
  for (const [type, count] of counts) {
    if (count > bestCount) {
      best = type;
      bestCount = count;
    }
  }
  const total = [...counts.values()].reduce((sum, count) => sum + count, 0);
  return bestCount / total >= 0.7 ? best : "text";
}

const SEMANTIC_HINTS: Array<{ tag: SemanticTag; pattern: RegExp }> = [
  { tag: "amount", pattern: /(betrag|kosten|cost|budget|preis|price|eur|euro|schaden|capex|opex|amount|summe)/i },
  { tag: "probability", pattern: /(wahrschein|eintritt|probab|likelihood|häufig|frequen)/i },
  { tag: "severity", pattern: /(ausmaß|ausmass|schwere|severity|impact|auswirkung|tragweite)/i },
  { tag: "priority", pattern: /(prio|prior|rang|rank|kritikalit|criticality)/i },
  { tag: "date", pattern: /(datum|date|termin|deadline|frist|zeitpunkt|baujahr|jahr)/i },
  { tag: "status", pattern: /(status|zustand|state|ampel|bewertung|ergebnis)/i },
  { tag: "identifier", pattern: /(^id$|nummer|number|nr\b|kennz|equnr|asset|anlage|objekt|kks)/i },
  { tag: "location", pattern: /(ort|standort|location|site|adresse|region|stort|koordinat|lat|lon)/i },
  { tag: "role", pattern: /(rolle|role|verantwort|owner|zuständig|zustaendig|prüfer|pruefer|freigabe)/i },
  { tag: "rule", pattern: /(regel|rule|grenz|schwelle|threshold|limit|norm|vorschrift|vollmacht)/i },
  { tag: "measurement", pattern: /(druck|bar|temperatur|celsius|messwert|sensor|wert|stunden|laufzeit)/i },
];

export function semanticOf(label: string): SemanticTag | null {
  const text = label.trim();
  if (!text) return null;
  for (const hint of SEMANTIC_HINTS) {
    if (hint.pattern.test(text)) return hint.tag;
  }
  return null;
}

const UNIT_HINTS: Array<{ unit: Unit; pattern: RegExp }> = [
  { unit: "kEUR", pattern: /(k€|keur|t€|teur|tsd\.?\s?€)/i },
  { unit: "EUR", pattern: /(€|eur\b|euro|betrag|kosten|preis|budget|schaden)/i },
  { unit: "percent", pattern: /(%|prozent|percent|quote|anteil)/i },
  { unit: "bar", pattern: /\b(bar|druck)\b/i },
  { unit: "celsius", pattern: /(°c|celsius|temperatur)/i },
  { unit: "hours", pattern: /\b(stunden|hours|std\.?|h)\b/i },
  { unit: "days", pattern: /\b(tage|days|tag)\b/i },
  { unit: "count", pattern: /(anzahl|count|menge|stück|stueck)/i },
  { unit: "score", pattern: /(score|punkte|index|bewertungszahl)/i },
];

export function unitOf(label: string, type: ValueType): Unit | null {
  if (type !== "number") return null;
  for (const hint of UNIT_HINTS) {
    if (hint.pattern.test(label)) return hint.unit;
  }
  return null;
}
