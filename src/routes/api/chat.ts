import { createFileRoute } from "@tanstack/react-router";
import { streamText, type ModelMessage } from "ai";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { chatModel, isOpenAiModel, responsesModel } from "@/lib/ai-gateway.server";
import { assertActiveUser } from "@/lib/guard.server";
import { rateLimit } from "@/lib/rate-limit.server";
import { UNTRUSTED_NOTICE, wrapUntrusted } from "@/lib/untrusted";
import {
  BUDGET_NOTICE,
  BudgetMeter,
  DEFAULT_BUDGET,
  checkInputBudget,
  declaresTimeout,
  readBudget,
} from "@/lib/budget";
import {
  type PrivacyMode,
  readPrivacyMode,
  redactPii,
  redactionSummary,
  stricterMode,
} from "@/lib/pii";

const Body = z.object({
  nodeId: z.string().uuid().optional(),
  model: z
    .string()
    .max(80)
    .regex(/^[a-z0-9-]+\/[a-z0-9.\-:]+$/i)
    .optional(),
  context: z.string().max(400_000).optional(),
  /** Verbundene Datenquellen: der Agent fragt sie ab, statt Zeilen zu lesen. */
  datasetIds: z.array(z.string().uuid()).max(5).optional(),
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().min(1).max(40_000),
      }),
    )
    .min(1)
    .max(200),
});

const filterSchema = z.object({
  column: z.string().max(200).describe("Spaltenname exakt wie im Aufbau angegeben"),
  op: z.enum(["eq", "neq", "gt", "gte", "lt", "lte", "contains", "oneOf", "filled"]),
  value: z.union([z.string(), z.number(), z.boolean(), z.array(z.string())]).optional(),
});

const toolInput = z.object({
  datasetId: z.string().uuid().describe("Kennung der Datenquelle aus dem Aufbau"),
  mode: z
    .enum(["aggregate", "rows"])
    .describe("aggregate für Zahlen über alle Zeilen, rows für einzelne Treffer"),
  fn: z
    .enum(["count", "sum", "avg", "min", "max"])
    .optional()
    .describe("Berechnung bei mode=aggregate"),
  measure: z.string().max(200).optional().describe("Wertspalte für sum, avg, min, max"),
  groupBy: z.string().max(200).optional().describe("Spalte, nach der gruppiert wird"),
  columns: z.array(z.string().max(200)).max(20).optional().describe("Spalten bei mode=rows"),
  filters: z.array(filterSchema).max(10).optional(),
  limit: z.number().int().min(1).max(30).optional().describe("Zeilen bei mode=rows, höchstens 30"),
});

const SYSTEM = `Du bist der KI-Assistent eines Wissens-Canvas. Der Nutzer verbindet Inhalte
(YouTube-Transkripte, Podcast-Transkripte, PDFs, Präsentationen, Notizen) mit einem Chat-Modul.
Arbeite ausschließlich mit den bereitgestellten Inhalten, erfinde nichts dazu.
Antworte in der Sprache des Nutzers, strukturiert und ohne Floskeln.
Wenn keine Inhalte verbunden sind, sage das kurz und bitte darum, Module mit dem Chat zu verbinden.
Große Tabellen stehen nicht im Text: Zahlen, Summen, Zählungen und einzelne Zeilen holst du
ausschließlich über das Werkzeug dataset_query. Rate nie einen Wert und rechne nie mit der Vorschau.

${UNTRUSTED_NOTICE}`;

/** Auch Werkzeug-Ergebnisse laufen durch den Datenschutz-Filter. */
function scrubValues(
  values: Record<string, unknown>,
  scrub: (text: string) => string,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(values)) {
    out[key] = typeof value === "string" ? scrub(value) : value;
  }
  return out;
}

async function userIdFrom(request: Request): Promise<string | null> {
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) return null;
  const client = createClient(process.env["SUPABASE_URL"]!, process.env["SUPABASE_PUBLISHABLE_KEY"]!, {
    auth: { persistSession: false, autoRefreshToken: false, storage: undefined },
  });
  const { data, error } = await client.auth.getUser(token);
  return error || !data.user ? null : data.user.id;
}

export const Route = createFileRoute("/api/chat")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const userId = await userIdFrom(request);
        if (!userId) return new Response("Bitte anmelden", { status: 401 });
        try {
          await assertActiveUser(userId);
        } catch {
          return new Response("Konto gesperrt", { status: 403 });
        }
        const limit = rateLimit(`chat:${userId}`, 30, 60_000);
        if (!limit.ok) {
          return new Response(`Zu viele Anfragen. Bitte in ${limit.retryAfter} s erneut versuchen.`, {
            status: 429,
            headers: { "retry-after": String(limit.retryAfter) },
          });
        }

        let body: z.infer<typeof Body>;
        try {
          body = Body.parse(await request.json());
        } catch {
          return new Response("Ungültige Anfrage", { status: 400 });
        }

        const modelId = body.model ?? "openai/gpt-6-astra";
        const history = body.messages.slice(-24);

        // Alles Weitere läuft mit den Rechten des Nutzers (RLS), nie mit Adminrechten.
        const scoped = createClient(
          process.env["SUPABASE_URL"]!,
          process.env["SUPABASE_PUBLISHABLE_KEY"]!,
          {
            auth: { persistSession: false, autoRefreshToken: false, storage: undefined },
            global: { headers: { Authorization: request.headers.get("authorization") ?? "" } },
          },
        );

        // Harte Budgetbremse und Zeitlimit: Grenzen des Bausteins, sonst Standarddeckel.
        let budget = DEFAULT_BUDGET;
        let timeoutMs: number | null = null;
        let privacy: PrivacyMode = "strict";
        if (body.nodeId) {
          const { data: node } = await scoped
            .from("nodes")
            .select("metadata,board_id")
            .eq("id", body.nodeId)
            .maybeSingle();
          if (node) {
            const meta = node.metadata as Record<string, unknown>;
            budget = readBudget(meta);
            if (declaresTimeout(meta)) timeoutMs = budget.timeoutSeconds * 1000;
            const { data: board } = await scoped
              .from("boards")
              .select("rules")
              .eq("id", node.board_id)
              .maybeSingle();
            privacy = stricterMode(readPrivacyMode(board?.rules), readPrivacyMode(meta));
          }
        }

        // Verbundene Tabellen kommen nur als Aufbau in den Prompt — nie als Zeilen.
        const allowedDatasets = new Set<string>();
        let datasetBrief = "";
        if (body.datasetIds?.length) {
          const { data: rows } = await scoped
            .from("datasets")
            .select("id,schema,row_count,verified")
            .in("id", body.datasetIds);
          for (const row of rows ?? []) {
            allowedDatasets.add(row.id);
            const columns = Array.isArray(row.schema)
              ? (row.schema as { key?: string; label?: string; type?: string; unit?: string }[])
              : [];
            datasetBrief += `${datasetSchemaBrief(
              {
                columns: columns.map((c) => ({
                  key: String(c.key ?? c.label ?? ""),
                  label: String(c.label ?? c.key ?? ""),
                  type: (c.type ?? "unknown") as never,
                  unit: (c.unit ?? null) as never,
                  semantic: null,
                  filled: 0,
                  total: 0,
                })),
              },
              row.row_count,
              row.id,
            )}\n\n`;
          }
        }

        // Datenschutz-Filter: persönliche Daten verlassen den Server nicht.
        const redactions: Record<string, number> = {};
        const scrub = (text: string) => {
          const r = redactPii(text, privacy);
          for (const [k, n] of Object.entries(r.counts)) redactions[k] = (redactions[k] ?? 0) + (n ?? 0);
          return r.text;
        };
        const context = scrub(body.context ?? "");
        let instructions = context
          ? `${SYSTEM}\n\nVerbundene Inhalte:\n\n${wrapUntrusted("verbundene Module", context)}`
          : SYSTEM;
        if (datasetBrief) {
          instructions += `\n\nVerbundene Datenquellen (nur Aufbau, Werte über dataset_query abfragen):\n\n${datasetBrief}`;
        }
        const messages: ModelMessage[] = history.map(
          (m) => ({ role: m.role, content: scrub(m.content) }) as ModelMessage,
        );
        const summary = redactionSummary(redactions);
        if (summary) console.info("chat privacy", privacy, summary);

        /**
         * Das Werkzeug rechnet in der Datenbank und liefert nur Ergebnisse
         * zurück. Es greift ausschließlich auf die verbundenen Datenquellen zu,
         * und immer mit den Rechten des angemeldeten Nutzers.
         */
        const tools = allowedDatasets.size
          ? {
              dataset_query: {
                description:
                  "Fragt eine verbundene Datenquelle ab. mode=aggregate liefert Summe, Mittelwert, "
                  + "Minimum, Maximum oder Anzahl über alle Zeilen (optional gruppiert); "
                  + "mode=rows liefert einzelne, gefilterte Zeilen.",
                inputSchema: toolInput,
                execute: async (input: z.infer<typeof toolInput>) => {
                  if (!allowedDatasets.has(input.datasetId)) {
                    return { error: "Diese Datenquelle ist mit dem Chat nicht verbunden." };
                  }
                  try {
                    const { runDatasetQuery } = await import("@/lib/datasets.server");
                    const query =
                      input.mode === "aggregate"
                        ? {
                            mode: "aggregate" as const,
                            fn: input.fn ?? "count",
                            groupBy: input.groupBy ?? null,
                            measure: input.measure ?? null,
                            filters: input.filters ?? [],
                          }
                        : {
                            mode: "rows" as const,
                            columns: input.columns ?? [],
                            filters: input.filters ?? [],
                            limit: Math.min(input.limit ?? 10, 30),
                            offset: 0,
                          };
                    const answer = await runDatasetQuery(
                      scoped as never,
                      input.datasetId,
                      query as never,
                    );
                    const out = answer.result;
                    return out.mode === "aggregate"
                      ? { total: out.total, matched: out.matched, groups: out.groups }
                      : {
                          total: out.total,
                          matched: out.matched,
                          rows: (out.rows ?? []).map((row) => scrubValues(row.values, scrub)),
                        };
                  } catch (toolError) {
                    console.error("dataset_query", toolError);
                    return { error: "Abfrage fehlgeschlagen." };
                  }
                },
              },
            }
          : undefined;

        const check = checkInputBudget(
          instructions + history.map((m) => m.content).join("\n"),
          budget,
        );
        if (!check.ok) {
          return new Response(check.reason, {
            status: 413,
            headers: { "x-budget": "exceeded" },
          });
        }
        const meter = new BudgetMeter(budget, check.inputTokens);

        // Zeitlimit nur, wenn der Baustein es deklariert; Stop des Nutzers bricht immer ab.
        const controller = new AbortController();
        request.signal.addEventListener("abort", () => controller.abort(), { once: true });
        let timedOut = false;
        const timer = timeoutMs
          ? setTimeout(() => {
              timedOut = true;
              controller.abort();
            }, timeoutMs)
          : undefined;

        const onError = ({ error }: { error: unknown }) => {
          console.error("chat error", error);
        };

        try {
          const result = isOpenAiModel(modelId)
            ? streamText({
                model: responsesModel(modelId),
                instructions,
                messages,
                abortSignal: controller.signal,
                onError,
                providerOptions: {
                  openai: {
                    forceReasoning: true,
                    reasoningEffort: "low",
                    reasoningSummary: "auto",
                    store: false,
                    include: ["reasoning.encrypted_content"],
                  },
                },
              })
            : streamText({
                model: chatModel(modelId),
                instructions,
                messages,
                abortSignal: controller.signal,
                onError,
              });

          const encoder = new TextEncoder();
          const stream = new ReadableStream<Uint8Array>({
            async start(out) {
              if (summary) out.enqueue(encoder.encode(`🔒 ${summary} (Datenschutz-Filter)\n\n`));
              try {
                for await (const chunk of result.textStream) {
                  out.enqueue(encoder.encode(chunk));
                  if (meter.add(chunk)) {
                    out.enqueue(encoder.encode(`\n\n${BUDGET_NOTICE}`));
                    controller.abort();
                    break;
                  }
                }
              } catch (streamError) {
                if (!timedOut) {
                  const detail =
                    streamError instanceof Error ? streamError.message : "Antwort fehlgeschlagen";
                  console.error("chat stream error", detail);
                  out.enqueue(encoder.encode(`\n\n⚠️ Fehler: ${detail}`));
                }
              }
              clearTimeout(timer);
              if (timedOut) {
                out.enqueue(
                  encoder.encode(`\n\n⏱️ Zeitlimit überschritten (${budget.timeoutSeconds} s) – die Antwort wurde abgebrochen.`),
                );
              }
              out.close();
              try {
                const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
                await supabaseAdmin.from("ai_usage").insert({
                  user_id: userId,
                  provider: "lovable",
                  fn: "chat",
                  model: modelId,
                  input_tokens: meter.inputTokens,
                  output_tokens: meter.outputTokens,
                  cost_usd: meter.costUsd,
                  ok: !meter.exceeded,
                });
              } catch (logError) {
                console.error("usage log", logError);
              }
            },
          });

          return new Response(stream, {
            headers: { "content-type": "text/plain; charset=utf-8" },
          });
        } catch (error) {
          if ((error as Error)?.name === "AbortError") return new Response(null, { status: 499 });
          const message = error instanceof Error ? error.message : "Unbekannter Fehler";
          console.error("chat error", message);
          return new Response(message, { status: 500 });
        }
      },
    },
  },
});
