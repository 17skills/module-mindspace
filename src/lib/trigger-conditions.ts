/**
 * Regelwerk für automatische Auslöser (Webhook und Zeitplan).
 *
 * Reine Rechenlogik ohne Netz und ohne Datenbank: aus einer eingehenden
 * Nachricht (JSON) und den zuletzt gemerkten Werten entsteht die Antwort
 * „starten" oder „überspringen". Das spart Kosten, weil ein Scope nur
 * läuft, wenn sich wirklich etwas Relevantes geändert hat.
 */

export const TRIGGER_OPERATORS = [
  "gt",
  "gte",
  "lt",
  "lte",
  "eq",
  "neq",
  "contains",
  "exists",
  "changed",
  "delta_abs",
  "delta_pct",
] as const;

export type TriggerOperator = (typeof TRIGGER_OPERATORS)[number];

export type TriggerCondition = {
  /** Pfad in die Nachricht, z. B. "current.wind_speed". */
  path: string;
  op: TriggerOperator;
  /** Vergleichswert; bei "changed" und "exists" ohne Bedeutung. */
  value?: string | number | undefined;
};

export type ConditionResult = {
  path: string;
  op: TriggerOperator;
  passed: boolean;
  /** Der jetzt gelesene Wert, kurz als Text. */
  actual: string;
  /** Der Wert aus dem letzten Lauf, sofern für die Regel nötig. */
  previous: string | null;
  reason: string;
};

export type TriggerEvaluation = {
  fired: boolean;
  match: "any" | "all";
  results: ConditionResult[];
  /** Neue Merkwerte für den nächsten Vergleich (Pfad → Wert). */
  nextValues: Record<string, unknown>;
  summary: string;
};

const OPERATOR_LABEL: Record<TriggerOperator, string> = {
  gt: "größer als",
  gte: "größer oder gleich",
  lt: "kleiner als",
  lte: "kleiner oder gleich",
  eq: "gleich",
  neq: "ungleich",
  contains: "enthält",
  exists: "ist vorhanden",
  changed: "hat sich geändert",
  delta_abs: "Änderung um mindestens",
  delta_pct: "Änderung um mindestens (%)",
};

export function operatorLabel(op: TriggerOperator): string {
  return OPERATOR_LABEL[op] ?? op;
}

/** Liest einen Punkt-Pfad aus einem Objekt; Zahlen adressieren Listenplätze. */
export function readPath(input: unknown, path: string): unknown {
  const steps = path
    .split(".")
    .map((part) => part.trim())
    .filter(Boolean);
  let current: unknown = input;
  for (const step of steps) {
    if (current == null) return undefined;
    if (Array.isArray(current)) {
      const index = Number(step);
      if (!Number.isInteger(index)) return undefined;
      current = current[index];
    } else if (typeof current === "object") {
      current = (current as Record<string, unknown>)[step];
    } else {
      return undefined;
    }
  }
  return current;
}

/** Wandelt Text oder Zahl in eine Zahl; erkennt auch "1.234,5" und "42 °C". */
export function toNumber(raw: unknown): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  if (typeof raw === "boolean") return raw ? 1 : 0;
  if (typeof raw !== "string") return null;
  const cleaned = raw.replace(/[^\d.,-]/g, "").replace(/\.(?=\d{3}\b)/g, "").replace(",", ".");
  if (!cleaned.trim()) return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

function short(raw: unknown): string {
  if (raw === undefined) return "–";
  if (raw === null) return "leer";
  if (typeof raw === "object") return JSON.stringify(raw).slice(0, 80);
  return String(raw).slice(0, 80);
}

function compare(op: TriggerOperator, actual: number, expected: number): boolean {
  switch (op) {
    case "gt":
      return actual > expected;
    case "gte":
      return actual >= expected;
    case "lt":
      return actual < expected;
    case "lte":
      return actual <= expected;
    default:
      return false;
  }
}

function evaluateOne(
  condition: TriggerCondition,
  payload: unknown,
  previous: Record<string, unknown>,
): ConditionResult {
  const actual = readPath(payload, condition.path);
  const before = previous[condition.path];
  const base = {
    path: condition.path,
    op: condition.op,
    actual: short(actual),
    previous: before === undefined ? null : short(before),
  };

  switch (condition.op) {
    case "exists": {
      const passed = actual !== undefined && actual !== null;
      return { ...base, passed, reason: passed ? "Feld vorhanden" : "Feld fehlt" };
    }
    case "changed": {
      const passed = JSON.stringify(actual ?? null) !== JSON.stringify(before ?? null);
      return {
        ...base,
        passed,
        reason: passed ? "Wert weicht vom letzten Lauf ab" : "Wert unverändert",
      };
    }
    case "contains": {
      const haystack = typeof actual === "string" ? actual : short(actual);
      const needle = String(condition.value ?? "");
      const passed = needle !== "" && haystack.toLowerCase().includes(needle.toLowerCase());
      return { ...base, passed, reason: passed ? `enthält „${needle}“` : `ohne „${needle}“` };
    }
    case "eq":
    case "neq": {
      const num = toNumber(actual);
      const expectedNum = toNumber(condition.value);
      let same: boolean;
      if (num !== null && expectedNum !== null) same = num === expectedNum;
      else same = short(actual) === String(condition.value ?? "");
      const passed = condition.op === "eq" ? same : !same;
      return { ...base, passed, reason: passed ? "Vergleich erfüllt" : "Vergleich nicht erfüllt" };
    }
    case "delta_abs":
    case "delta_pct": {
      const num = toNumber(actual);
      const beforeNum = toNumber(before);
      const limit = toNumber(condition.value);
      if (num === null || limit === null) {
        return { ...base, passed: false, reason: "Kein Zahlenwert lesbar" };
      }
      if (beforeNum === null) {
        return { ...base, passed: false, reason: "Noch kein Vergleichswert vorhanden" };
      }
      const diff = Math.abs(num - beforeNum);
      if (condition.op === "delta_abs") {
        const passed = diff >= limit;
        return { ...base, passed, reason: `Änderung ${diff.toFixed(3)} (Grenze ${limit})` };
      }
      if (beforeNum === 0) {
        return { ...base, passed: false, reason: "Vorwert 0 – Prozentvergleich nicht möglich" };
      }
      const pct = (diff / Math.abs(beforeNum)) * 100;
      const passed = pct >= limit;
      return { ...base, passed, reason: `Änderung ${pct.toFixed(1)} % (Grenze ${limit} %)` };
    }
    default: {
      const num = toNumber(actual);
      const expectedNum = toNumber(condition.value);
      if (num === null || expectedNum === null) {
        return { ...base, passed: false, reason: "Kein Zahlenwert lesbar" };
      }
      const passed = compare(condition.op, num, expectedNum);
      return {
        ...base,
        passed,
        reason: `${num} ${operatorLabel(condition.op)} ${expectedNum}: ${passed ? "ja" : "nein"}`,
      };
    }
  }
}

/**
 * Wertet alle Regeln aus. Ohne Regeln läuft der Scope immer.
 * `match` entscheidet, ob eine erfüllte Regel reicht oder alle passen müssen.
 */
export function evaluateTrigger(
  conditions: TriggerCondition[],
  payload: unknown,
  previous: Record<string, unknown> = {},
  match: "any" | "all" = "any",
): TriggerEvaluation {
  const usable = conditions.filter((c) => c.path.trim() !== "");
  const results = usable.map((condition) => evaluateOne(condition, payload, previous));
  const nextValues: Record<string, unknown> = { ...previous };
  for (const condition of usable) {
    const value = readPath(payload, condition.path);
    if (value === undefined) continue;
    nextValues[condition.path] = value === null || typeof value !== "object" ? value : short(value);
  }

  const fired =
    results.length === 0
      ? true
      : match === "all"
        ? results.every((r) => r.passed)
        : results.some((r) => r.passed);

  const summary =
    results.length === 0
      ? "Keine Bedingung gesetzt – Ablauf startet"
      : fired
        ? `Bedingung erfüllt (${results.filter((r) => r.passed).length}/${results.length})`
        : `Bedingung nicht erfüllt (0 von ${results.length} Treffern nötig)`;

  return { fired, match, results, nextValues, summary };
}

/** Prüft und säubert eine Regelliste aus fremder Eingabe. */
export function parseConditions(raw: unknown): TriggerCondition[] {
  if (!Array.isArray(raw)) return [];
  const out: TriggerCondition[] = [];
  for (const item of raw.slice(0, 20)) {
    const row = (item ?? {}) as Record<string, unknown>;
    const path = typeof row["path"] === "string" ? row["path"].trim().slice(0, 200) : "";
    const op = row["op"];
    if (!path || typeof op !== "string") continue;
    if (!(TRIGGER_OPERATORS as readonly string[]).includes(op)) continue;
    const value = row["value"];
    out.push({
      path,
      op: op as TriggerOperator,
      value:
        typeof value === "number"
          ? value
          : typeof value === "string"
            ? value.slice(0, 200)
            : undefined,
    });
  }
  return out;
}
