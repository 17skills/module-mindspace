import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { loadAiKeyConfig, recordUsage, resolveRoute, runStructured } from "@/lib/ai-keys.server";
import { JEV_MODEL } from "@/lib/ai-functions";

const GATEWAY = "https://ai.gateway.lovable.dev/v1";
const MAX_BODY = 200_000;

/** Replaces {{SECRET_NAME}} with the server-side secret; never leaves the server. */
function fillSecrets(text: string): string {
  return text.replace(/\{\{\s*([A-Z0-9_]+)\s*\}\}/g, (_match, name: string) => {
    const value = process.env[name];
    if (!value) throw new Error(`Der Zugangsschlüssel „${name}“ ist nicht hinterlegt`);
    return value;
  });
}

const PRIVATE_HOST =
  /^(localhost|127\.|0\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|\[?::1\]?|.*\.internal|metadata\.google\.internal)/i;

function safeUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("Die Adresse ist ungültig");
  }
  if (url.protocol !== "https:") throw new Error("Nur https-Adressen sind erlaubt");
  if (PRIVATE_HOST.test(url.hostname)) throw new Error("Diese Adresse ist nicht erlaubt");
  return url;
}

const Pair = z.object({ key: z.string(), value: z.string() });

/** Calls a public web API on behalf of an API module on the canvas. */
export const runApiModule = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({
        url: z.string().min(1),
        method: z.enum(["GET", "POST"]).default("GET"),
        params: z.array(Pair).default([]),
        headers: z.array(Pair).default([]),
        body: z.string().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const url = safeUrl(fillSecrets(data.url.trim()));
    for (const pair of data.params) {
      if (!pair.key.trim()) continue;
      url.searchParams.set(pair.key.trim(), fillSecrets(pair.value));
    }
    safeUrl(url.toString());

    const headers = new Headers({ accept: "application/json, text/plain;q=0.8, */*;q=0.5" });
    for (const pair of data.headers) {
      if (!pair.key.trim()) continue;
      headers.set(pair.key.trim(), fillSecrets(pair.value));
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20_000);
    try {
      const init: RequestInit = { method: data.method, headers, signal: controller.signal };
      if (data.method === "POST" && data.body?.trim()) {
        init.body = fillSecrets(data.body);
        if (!headers.has("content-type")) headers.set("content-type", "application/json");
      }
      const response = await fetch(url, init);
      const text = (await response.text()).slice(0, MAX_BODY);
      return {
        status: response.status,
        contentType: response.headers.get("content-type") ?? "",
        body: text,
        at: new Date().toISOString(),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Abruf fehlgeschlagen";
      throw new Error(message.includes("abort") ? "Zeitüberschreitung beim Abruf" : message);
    } finally {
      clearTimeout(timer);
    }
  });

const Question = z.object({
  id: z.string().min(1),
  type: z.enum(["choice", "score", "noul"]),
  instructions: z.string().min(1),
  /** choice: option labels; score: ordered level descriptions; noul: unused. */
  options: z.array(z.string()).default([]),
  /** Rule that applies to this question only. */
  rule: z.string().optional(),
});

export type DecisionAnswer = {
  id: string;
  type: "choice" | "score" | "noul";
  choice?: string;
  score?: number;
  noul?: number;
  confidence?: number;
};

/** Typed decisions (TypeSafe Jev) over the context connected to a module. */
export const runDecision = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({
        context: z.string().min(1),
        policy: z.string().optional(),
        questions: z.array(Question).min(1),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const cfg = await loadAiKeyConfig(context.supabase, context.userId);
    const route = resolveRoute(cfg, "decision");

    // Eigener Anbieter (BYOK): typisierte Antworten über ein strukturiertes Schema.
    if (route.entry) {
      try {
        const answers = await decideWithOwnProvider(cfg, data);
        return {
          answers,
          at: new Date().toISOString(),
          provider: route.provider,
          model: route.model ?? "",
        };
      } catch {
        /* Sicherer Rückfall auf die mitgelieferte Entscheidungs-Engine */
      }
    }

    const answers = await decideWithJev(data, cfg.userId);
    return { answers, at: new Date().toISOString(), provider: "lovable", model: JEV_MODEL };
  });

type DecisionInput = {
  context: string;
  policy?: string | undefined;
  questions: z.infer<typeof Question>[];
};

/** Mitgelieferte Entscheidungs-Engine (TypeSafe Jev) über das Lovable-Gateway. */
async function decideWithJev(data: DecisionInput, userId: string): Promise<DecisionAnswer[]> {
  const key = process.env["LOVABLE_API_KEY"];
  if (!key) throw new Error("LOVABLE_API_KEY fehlt");

  const rules = data.policy?.trim() ? `\n\nRegeln: ${data.policy.trim().slice(0, 4000)}` : "";
  const questions: Record<string, unknown> = {};
  data.questions.forEach((question, index) => {
    const id = `q${index}`;
    const own = question.rule?.trim()
      ? `\n\nRegel für diese Frage: ${question.rule.trim().slice(0, 2000)}`
      : "";
    const instructions = `${question.instructions}${rules}${own}`;
    if (question.type === "choice") {
      const criteria: Record<string, string> = {};
      const options = question.options.filter((option) => option.trim());
      for (const option of options.length ? options : ["ja", "nein"]) {
        criteria[option] = option;
      }
      questions[id] = { type: "choice", instructions, criteria };
    } else if (question.type === "score") {
      const levels = question.options.filter((option) => option.trim());
      questions[id] = {
        type: "score",
        instructions,
        criteria: (levels.length >= 2
          ? levels
          : ["trifft nicht zu", "trifft teilweise zu", "trifft voll zu"]
        ).map((description) => ({ description })),
      };
    } else {
      questions[id] = { type: "noul", instructions };
    }
  });

  const state = data.context.slice(0, 200_000);
  const response = await fetch(`${GATEWAY}/systemone`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${key}`,
      "X-Lovable-AIG-SDK": "fetch",
    },
    body: JSON.stringify({
      model: JEV_MODEL,
      state: {
        context: state,
        ...(data.policy?.trim() ? { rules: data.policy.trim().slice(0, 4000) } : {}),
      },
      questions,
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    await recordUsage({
      userId,
      provider: "lovable",
      fn: "decision",
      model: JEV_MODEL,
      inputText: state,
      outputText: "",
      ok: false,
    });
    throw new Error(`Entscheidung fehlgeschlagen [${response.status}]: ${detail.slice(0, 300)}`);
  }

  const payload = (await response.json()) as {
    answers?: Record<
      string,
      { choice?: string; score?: number; noul?: number; confidence?: number }
    >;
  };

  await recordUsage({
    userId,
    provider: "lovable",
    fn: "decision",
    model: JEV_MODEL,
    inputText: state,
    outputText: JSON.stringify(payload.answers ?? {}),
    ok: true,
  });

  return data.questions.map((question, index) => {
    const raw = payload.answers?.[`q${index}`] ?? {};
    return {
      id: question.id,
      type: question.type,
      ...(typeof raw.choice === "string" ? { choice: raw.choice } : {}),
      ...(typeof raw.score === "number" ? { score: raw.score } : {}),
      ...(typeof raw.noul === "number" ? { noul: raw.noul } : {}),
      ...(typeof raw.confidence === "number" ? { confidence: raw.confidence } : {}),
    };
  });
}

const DECISION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    answers: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: { type: "string" },
          choice: { type: "string" },
          score: { type: "number" },
          noul: { type: "number" },
          confidence: { type: "number" },
        },
        required: ["id", "choice", "score", "noul", "confidence"],
      },
    },
  },
  required: ["answers"],
} as const;

/** Entscheidungen über den eigenen KI-Anbieter, im selben typisierten Format. */
async function decideWithOwnProvider(
  cfg: Awaited<ReturnType<typeof loadAiKeyConfig>>,
  data: DecisionInput,
): Promise<DecisionAnswer[]> {
  const rules = data.policy?.trim() ? `\nAllgemeine Regeln: ${data.policy.trim().slice(0, 4000)}` : "";
  const list = data.questions
    .map((question, index) => {
      const own = question.rule?.trim() ? `\n  Regel: ${question.rule.trim().slice(0, 2000)}` : "";
      if (question.type === "choice") {
        const options = question.options.filter((option) => option.trim());
        return `q${index} (choice, erlaubte Werte: ${(options.length ? options : ["ja", "nein"]).join(" | ")}): ${question.instructions}${own}`;
      }
      if (question.type === "score") {
        const levels = question.options.filter((option) => option.trim());
        const scale = levels.length >= 2 ? `Stufen: ${levels.join(" | ")}` : "Skala 0 bis 1";
        return `q${index} (score, ${scale}): ${question.instructions}${own}`;
      }
      return `q${index} (noul, 0 = nein, 1 = ja): ${question.instructions}${own}`;
    })
    .join("\n");

  const prompt = `Du triffst typisierte Entscheidungen auf Basis des folgenden Kontexts. Erfinde nichts dazu.${rules}

Kontext:
${data.context.slice(0, 120_000)}

Fragen:
${list}

Antworte für jede Frage mit ihrer Kennung (q0, q1, …):
- choice: "choice" enthält genau einen der erlaubten Werte, "score" und "noul" sind 0.
- score: "score" ist eine Zahl zwischen 0 und 1, "choice" ist "", "noul" ist 0.
- noul: "noul" ist 0 oder 1, "choice" ist "", "score" ist 0.
- "confidence" ist immer eine Zahl zwischen 0 und 1.`;

  const text = await runStructured(cfg, {
    fn: "decision",
    prompt,
    schemaName: "typed_decisions",
    schema: DECISION_SCHEMA,
  });

  const parsed = z
    .object({
      answers: z.array(
        z.object({
          id: z.string(),
          choice: z.string().optional(),
          score: z.number().optional(),
          noul: z.number().optional(),
          confidence: z.number().optional(),
        }),
      ),
    })
    .parse(JSON.parse(text));

  return data.questions.map((question, index) => {
    const raw = parsed.answers.find((answer) => answer.id === `q${index}`);
    return {
      id: question.id,
      type: question.type,
      ...(question.type === "choice" && raw?.choice ? { choice: raw.choice } : {}),
      ...(question.type === "score" && typeof raw?.score === "number" ? { score: raw.score } : {}),
      ...(question.type === "noul" && typeof raw?.noul === "number" ? { noul: raw.noul } : {}),
      ...(typeof raw?.confidence === "number" ? { confidence: raw.confidence } : {}),
    };
  });
  });
