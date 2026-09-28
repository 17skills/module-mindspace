/**
 * Harte Budgetbremse: jedes Modul darf nur so viele Token verbrauchen, wie im
 * Baustein deklariert ist (engine.governance). Ohne Deklaration gilt ein
 * konservativer Gesamtdeckel. Reine Funktionen, damit sie testbar bleiben.
 */
import { estimateTokens, estimateCost } from "@/lib/ai-pricing";

export type Budget = {
  maxSteps: number;
  maxTokenBudget: number;
  timeoutSeconds: number;
};

/** Gilt, wenn ein Modul kein eigenes Budget deklariert. */
export const DEFAULT_BUDGET: Budget = {
  maxSteps: 5,
  maxTokenBudget: 30_000,
  timeoutSeconds: 60,
};

/** Obergrenze, die kein Modul überschreiten darf – auch nicht per Deklaration. */
export const HARD_TOKEN_CEILING = 200_000;

function clamp(value: unknown, min: number, max: number, fallback: number): number {
  const num = typeof value === "number" && Number.isFinite(value) ? Math.floor(value) : NaN;
  if (Number.isNaN(num)) return fallback;
  return Math.min(max, Math.max(min, num));
}

/** Liest das deklarierte Budget aus den Modul-Einstellungen. */
export function readBudget(metadata: Record<string, unknown> | null | undefined): Budget {
  const meta = metadata ?? {};
  const raw = meta["governance"];
  const g = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const timeout = g["timeoutSeconds"] ?? meta["timeoutSeconds"];
  return {
    maxSteps: clamp(g["maxSteps"], 1, 50, DEFAULT_BUDGET.maxSteps),
    maxTokenBudget: clamp(
      g["maxTokenBudget"],
      1,
      HARD_TOKEN_CEILING,
      DEFAULT_BUDGET.maxTokenBudget,
    ),
    timeoutSeconds: clamp(timeout, 1, 300, DEFAULT_BUDGET.timeoutSeconds),
  };
}

/** true, wenn das Modul selbst ein Zeitlimit deklariert. */
export function declaresTimeout(metadata: Record<string, unknown> | null | undefined): boolean {
  const meta = metadata ?? {};
  const g = meta["governance"] as Record<string, unknown> | undefined;
  return typeof (g?.["timeoutSeconds"] ?? meta["timeoutSeconds"]) === "number";
}

/** Obergrenze für einen ganzen Durchlauf, egal wie viele Schritte. */
export const RUN_MAX_SECONDS = 300;

export class TimeoutError extends Error {
  readonly seconds: number;
  constructor(seconds: number) {
    super(`Zeitlimit überschritten (${seconds} s)`);
    this.name = "TimeoutError";
    this.seconds = seconds;
  }
}

/** Führt eine Aufgabe mit hartem Zeitlimit aus; das Signal bricht laufende Anfragen ab. */
export async function withTimeout<T>(
  task: (signal: AbortSignal) => Promise<T>,
  ms: number,
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new TimeoutError(Math.round(ms / 1000)));
    }, Math.max(1, ms));
  });
  try {
    return await Promise.race([task(controller.signal), deadline]);
  } finally {
    clearTimeout(timer);
  }
}

export type BudgetCheck =
  | { ok: true; inputTokens: number; remaining: number }
  | { ok: false; inputTokens: number; remaining: 0; reason: string };

/** Prüft vor dem Aufruf: passt allein die Eingabe schon nicht ins Budget? */
export function checkInputBudget(text: string, budget: Budget): BudgetCheck {
  const inputTokens = estimateTokens(text);
  if (inputTokens >= budget.maxTokenBudget) {
    return {
      ok: false,
      inputTokens,
      remaining: 0,
      reason: `Budget überschritten: Die Eingabe benötigt rund ${inputTokens} Token, erlaubt sind ${budget.maxTokenBudget}.`,
    };
  }
  return { ok: true, inputTokens, remaining: budget.maxTokenBudget - inputTokens };
}

/** Zähler für die laufende Ausgabe – bricht ab, sobald das Budget erreicht ist. */
export class BudgetMeter {
  readonly budget: Budget;
  readonly inputTokens: number;
  private output = "";
  private stopped = false;

  constructor(budget: Budget, inputTokens: number) {
    this.budget = budget;
    this.inputTokens = inputTokens;
  }

  /** true, wenn nach diesem Stück abgebrochen werden muss. */
  add(chunk: string): boolean {
    if (this.stopped) return true;
    this.output += chunk;
    if (this.total >= this.budget.maxTokenBudget) this.stopped = true;
    return this.stopped;
  }

  get outputTokens(): number {
    return estimateTokens(this.output || " ") - (this.output ? 0 : 1);
  }

  get total(): number {
    return this.inputTokens + this.outputTokens;
  }

  get exceeded(): boolean {
    return this.stopped;
  }

  get costUsd(): number {
    return estimateCost("lovable", this.inputTokens, this.outputTokens);
  }
}

export const BUDGET_NOTICE =
  "⚠️ Budget überschritten – die Antwort wurde abgebrochen. Das Token-Budget dieses Bausteins ist erreicht.";
