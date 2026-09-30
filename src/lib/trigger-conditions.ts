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

/** Gemerkter Wert eines Feldes – bewusst nur einfache Werte. */
export type TriggerValue = string | number | boolean | null;

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
  nextValues: Record<string, TriggerValue>;
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
  const nextValues: Record<string, TriggerValue> = {};
  for (const [key, value] of Object.entries(previous)) {
    nextValues[key] = value === null || typeof value !== "object" ? (value as TriggerValue) : short(value);
  }
  for (const condition of usable) {
    const value = readPath(payload, condition.path);
    if (value === undefined) continue;
    nextValues[condition.path] =
      value === null || typeof value !== "object" ? (value as TriggerValue) : short(value);
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

/** Zerlegt "users[0].email" bzw. "users.0.email" in ["users","0","email"]; "[*]" wird "*". */
export function pathSegments(path: string): string[] {
  return path
    .replace(/\[(\*|\d+)\]/g, ".$1")
    .split(".")
    .map((p) => p.trim())
    .filter(Boolean);
}

/**
 * Passt ein Pfad auf ein Ausschlussmuster? "*" steht für genau eine Ebene oder einen
 * Listenplatz, "**" für beliebig viele Ebenen. Unterfelder eines Treffers zählen mit.
 */
export function matchesExclude(path: string, pattern: string): boolean {
  const target = pathSegments(path);
  const pat = pathSegments(pattern);
  if (!pat.length) return false;
  const walk = (ti: number, pi: number): boolean => {
    if (pi === pat.length) return true; // Muster zu Ende: Treffer inkl. Unterfeldern
    if (pat[pi] === "**") {
      for (let k = ti; k <= target.length; k++) if (walk(k, pi + 1)) return true;
      return false;
    }
    if (ti >= target.length) return false;
    return (pat[pi] === "*" || pat[pi] === target[ti]) && walk(ti + 1, pi + 1);
  };
  return walk(0, 0);
}

function isExcluded(path: string, exclude: string[]): boolean {
  return exclude.some((p) => matchesExclude(path, p));
}

/** Gibt eine Kopie der Nachricht zurück, in der ausgeschlossene Felder ersetzt sind. */
export function redactPayload(payload: unknown, exclude: string[], path = ""): unknown {
  if (path && isExcluded(path, exclude)) return "[ausgeschlossen]";
  if (Array.isArray(payload)) return payload.map((v, i) => redactPayload(v, exclude, `${path}[${i}]`));
  if (payload && typeof payload === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(payload)) out[k] = redactPayload(v, exclude, path ? `${path}.${k}` : k);
    return out;
  }
  return payload;
}

/** Prüft ein Ausschlussmuster auf Schreibfehler; liefert eine Erklärung oder null. */
export function validateExcludePattern(pattern: string): string | null {
  const p = pattern.trim();
  if (!p) return "Leeres Muster.";
  if (p.length > 200) return "Zu lang (max. 200 Zeichen).";
  if (/\s/.test(p)) return "Leerzeichen sind im Pfad nicht erlaubt.";
  if ((p.match(/\[/g) ?? []).length !== (p.match(/\]/g) ?? []).length) return "Eckige Klammer nicht geschlossen.";
  const bad = p.match(/\[([^\]]*)\]/g)?.find((b) => !/^\[(\*|\d+)\]$/.test(b));
  if (bad) return `${bad} ist ungültig – erlaubt sind [*] oder eine Zahl wie [0].`;
  if (/^\.|\.$|\.\./.test(p)) return "Punkt am Anfang, Ende oder doppelt.";
  const segs = pathSegments(p);
  if (segs.some((s) => s.includes("*") && s !== "*" && s !== "**")) return "* nur als ganze Ebene (z. B. a.*.b oder **.token).";
  return null;
}

/** Sammelt alle Pfade eines JSON-Werts in Klammerschreibweise. */
export function listPaths(payload: unknown, path = "", out: string[] = []): string[] {
  if (path) out.push(path);
  if (Array.isArray(payload)) payload.forEach((v, i) => listPaths(v, `${path}[${i}]`, out));
  else if (payload && typeof payload === "object")
    for (const [k, v] of Object.entries(payload)) listPaths(v, path ? `${path}.${k}` : k, out);
  return out;
}

/** Säubert die Liste sensibler Pfade (max. 20, je 200 Zeichen). */
export function parseExcludePaths(raw: unknown): string[] {
  const list = Array.isArray(raw) ? raw : typeof raw === "string" ? raw.split(/[\n,]/) : [];
  return Array.from(new Set(list.map((p) => String(p).trim().slice(0, 200)).filter(Boolean))).slice(0, 20);
}

/**
 * Grund für das Ausführungsprotokoll. Werte sind standardmäßig geschwärzt;
 * ausgeschlossene Pfade erscheinen gar nicht, nur als Anzahl.
 */
export function formatLogReason(
  evaluation: Pick<TriggerEvaluation, "results" | "summary">,
  options: { showValues?: boolean; exclude?: string[] } = {},
): string {
  const exclude = options.exclude ?? [];
  let hidden = 0;
  const parts: string[] = [];
  for (const r of evaluation.results) {
    if (isExcluded(r.path, exclude)) {
      hidden += 1;
      continue;
    }
    const value = options.showValues ? r.actual : "•••";
    parts.push(`${r.path} ${r.op} ${r.passed ? "✓" : "✗"} (${value})`);
  }
  if (hidden) parts.push(`${hidden} Regel(n) ausgeblendet`);
  return parts.length ? `${evaluation.summary}: ${parts.join("; ")}` : evaluation.summary;
}
