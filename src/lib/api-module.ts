import type { NodeRecord } from "@/components/canvas/board-context";

export type Pair = { key: string; value: string };

export type ApiConfig = {
  url: string;
  method: "GET" | "POST";
  params: Pair[];
  headers: Pair[];
  body: string;
  /** Path into the JSON answer, e.g. "trending_searches.0.search_volume". */
  pick: string;
  lastStatus: number | null;
  lastAt: string | null;
};

function pairs(raw: unknown): Pair[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((item) => {
    const row = (item ?? {}) as Record<string, unknown>;
    return {
      key: typeof row["key"] === "string" ? row["key"] : "",
      value: typeof row["value"] === "string" ? row["value"] : "",
    };
  });
}

function text(raw: unknown): string {
  return typeof raw === "string" ? raw : "";
}

/** Settings of an API module (metadata). */
export function readApi(record: NodeRecord | undefined | null): ApiConfig {
  const meta = (record?.metadata ?? {}) as Record<string, unknown>;
  const status = meta["lastStatus"];
  return {
    url: text(meta["url"]),
    method: meta["method"] === "POST" ? "POST" : "GET",
    params: pairs(meta["params"]),
    headers: pairs(meta["headers"]),
    body: text(meta["body"]),
    pick: text(meta["pick"]),
    lastStatus: typeof status === "number" ? status : null,
    lastAt: typeof meta["lastAt"] === "string" ? meta["lastAt"] : null,
  };
}

/** Reads a dotted path out of a JSON string; array indexes are plain numbers. */
export function pickPath(content: string | null | undefined, path: string): unknown {
  if (!content || !path.trim()) return undefined;
  let data: unknown;
  try {
    data = JSON.parse(content);
  } catch {
    return undefined;
  }
  let current: unknown = data;
  for (const step of path.split(".").map((part) => part.trim()).filter(Boolean)) {
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

/** Numeric value an API module passes on through its connections. */
export function apiValue(record: NodeRecord | undefined | null): number | null {
  const config = readApi(record);
  const picked = pickPath(record?.content, config.pick);
  if (typeof picked === "number" && Number.isFinite(picked)) return picked;
  if (typeof picked === "string") {
    const parsed = Number(picked.replace(/[^\d.,-]/g, "").replace(/\.(?=\d{3}\b)/g, "").replace(",", "."));
    return Number.isFinite(parsed) && picked.trim() ? parsed : null;
  }
  return null;
}

/** Short, readable preview of the last answer. */
export function apiPreview(record: NodeRecord | undefined | null): string {
  const content = record?.content ?? "";
  if (!content) return "";
  try {
    return JSON.stringify(JSON.parse(content), null, 2).slice(0, 4000);
  } catch {
    return content.slice(0, 4000);
  }
}

export type DecisionKind = "choice" | "score" | "noul";

export type DecisionQuestion = {
  id: string;
  type: DecisionKind;
  instructions: string;
  options: string[];
};

export type StoredAnswer = {
  id: string;
  type: DecisionKind;
  choice?: string;
  score?: number;
  noul?: number;
  confidence?: number;
};

export function readQuestions(record: NodeRecord | undefined | null): DecisionQuestion[] {
  const raw = (record?.metadata ?? {})["questions"];
  if (!Array.isArray(raw)) return [];
  return raw.map((item, index) => {
    const row = (item ?? {}) as Record<string, unknown>;
    const type = row["type"];
    return {
      id: typeof row["id"] === "string" ? row["id"] : `f${index}`,
      type: type === "choice" || type === "score" ? type : "noul",
      instructions: text(row["instructions"]),
      options: Array.isArray(row["options"]) ? row["options"].map((o) => String(o)) : [],
    };
  });
}

export function readAnswers(record: NodeRecord | undefined | null): StoredAnswer[] {
  const raw = (record?.metadata ?? {})["answers"];
  if (!Array.isArray(raw)) return [];
  return raw as StoredAnswer[];
}

/** The question whose result is passed on (metadata.outputQuestion). */
export function decisionValue(record: NodeRecord | undefined | null): number | null {
  const answers = readAnswers(record);
  if (answers.length === 0) return null;
  const chosen = (record?.metadata ?? {})["outputQuestion"];
  const answer =
    (typeof chosen === "string" ? answers.find((item) => item.id === chosen) : undefined) ??
    answers[0]!;
  if (typeof answer.score === "number") return answer.score;
  if (typeof answer.noul === "number") return answer.noul;
  return null;
}

/** Readable result of one answer. */
export function answerLabel(answer: StoredAnswer | undefined): string {
  if (!answer) return "–";
  if (answer.choice) return answer.choice;
  if (typeof answer.noul === "number") {
    return `${answer.noul >= 0.5 ? "Ja" : "Nein"} (${Math.round(answer.noul * 100)} %)`;
  }
  if (typeof answer.score === "number") return answer.score.toFixed(2);
  return "–";
}
