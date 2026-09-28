import { createFileRoute } from "@tanstack/react-router";
import { streamText, type ModelMessage } from "ai";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { chatModel, isOpenAiModel, responsesModel } from "@/lib/ai-gateway.server";
import { assertActiveUser } from "@/lib/guard.server";
import { rateLimit } from "@/lib/rate-limit.server";
import { UNTRUSTED_NOTICE, wrapUntrusted } from "@/lib/untrusted";
import { BUDGET_NOTICE, BudgetMeter, DEFAULT_BUDGET, checkInputBudget, readBudget } from "@/lib/budget";

const Body = z.object({
  nodeId: z.string().uuid().optional(),
  model: z
    .string()
    .max(80)
    .regex(/^[a-z0-9-]+\/[a-z0-9.\-:]+$/i)
    .optional(),
  context: z.string().max(400_000).optional(),
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

const SYSTEM = `Du bist der KI-Assistent eines Wissens-Canvas. Der Nutzer verbindet Inhalte
(YouTube-Transkripte, Podcast-Transkripte, PDFs, Präsentationen, Notizen) mit einem Chat-Modul.
Arbeite ausschließlich mit den bereitgestellten Inhalten, erfinde nichts dazu.
Antworte in der Sprache des Nutzers, strukturiert und ohne Floskeln.
Wenn keine Inhalte verbunden sind, sage das kurz und bitte darum, Module mit dem Chat zu verbinden.

${UNTRUSTED_NOTICE}`;

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
        const context = body.context ?? "";
        const instructions = context
          ? `${SYSTEM}\n\nVerbundene Inhalte:\n\n${wrapUntrusted("verbundene Module", context)}`
          : SYSTEM;
        const messages: ModelMessage[] = history.map(
          (m) => ({ role: m.role, content: m.content }) as ModelMessage,
        );

        // Harte Budgetbremse: Grenzen des Bausteins gelten, sonst der Standarddeckel.
        let budget = DEFAULT_BUDGET;
        if (body.nodeId) {
          const scoped = createClient(
            process.env["SUPABASE_URL"]!,
            process.env["SUPABASE_PUBLISHABLE_KEY"]!,
            {
              auth: { persistSession: false, autoRefreshToken: false, storage: undefined },
              global: { headers: { Authorization: request.headers.get("authorization") ?? "" } },
            },
          );
          const { data: node } = await scoped
            .from("nodes")
            .select("metadata")
            .eq("id", body.nodeId)
            .maybeSingle();
          if (node) budget = readBudget(node.metadata as Record<string, unknown>);
        }
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

        const onError = ({ error }: { error: unknown }) => {
          console.error("chat error", error);
        };

        try {
          const result = isOpenAiModel(modelId)
            ? streamText({
                model: responsesModel(modelId),
                instructions,
                messages,
                abortSignal: request.signal,
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
                abortSignal: request.signal,
                onError,
              });

          const encoder = new TextEncoder();
          const stream = new ReadableStream<Uint8Array>({
            async start(controller) {
              try {
                for await (const chunk of result.textStream) {
                  controller.enqueue(encoder.encode(chunk));
                  if (meter.add(chunk)) {
                    controller.enqueue(encoder.encode(`\n\n${BUDGET_NOTICE}`));
                    break;
                  }
                }
              } catch (streamError) {
                const detail =
                  streamError instanceof Error ? streamError.message : "Antwort fehlgeschlagen";
                console.error("chat stream error", detail);
                controller.enqueue(encoder.encode(`\n\n⚠️ Fehler: ${detail}`));
              }
              controller.close();
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
