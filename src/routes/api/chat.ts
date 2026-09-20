import { createFileRoute } from "@tanstack/react-router";
import { streamText, type ModelMessage } from "ai";
import { chatModel, isOpenAiModel, responsesModel } from "@/lib/ai-gateway.server";

type Body = {
  model?: string;
  context?: string;
  messages?: { role: "user" | "assistant"; content: string }[];
};

const SYSTEM = `Du bist der KI-Assistent eines Wissens-Canvas. Der Nutzer verbindet Inhalte
(YouTube-Transkripte, Podcast-Transkripte, PDFs, Präsentationen, Notizen) mit einem Chat-Modul.
Arbeite ausschließlich mit den bereitgestellten Inhalten, erfinde nichts dazu.
Antworte in der Sprache des Nutzers, strukturiert und ohne Floskeln.
Wenn keine Inhalte verbunden sind, sage das kurz und bitte darum, Module mit dem Chat zu verbinden.`;

export const Route = createFileRoute("/api/chat")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let body: Body;
        try {
          body = (await request.json()) as Body;
        } catch {
          return new Response("Ungültige Anfrage", { status: 400 });
        }

        const modelId = body.model ?? "openai/gpt-6-astra";
        const history = (body.messages ?? []).slice(-24);
        if (history.length === 0) return new Response("Keine Nachricht", { status: 400 });

        const context = (body.context ?? "").slice(0, 400_000);
        const messages: ModelMessage[] = [
          { role: "system", content: SYSTEM },
          ...(context
            ? [
                {
                  role: "system" as const,
                  content: `Verbundene Inhalte:\n\n${context}`,
                },
              ]
            : []),
          ...history.map((m) => ({ role: m.role, content: m.content }) as ModelMessage),
        ];

        try {
          const result = isOpenAiModel(modelId)
            ? streamText({
                model: responsesModel(modelId),
                messages,
                abortSignal: request.signal,
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
            : streamText({ model: chatModel(modelId), messages, abortSignal: request.signal });

          return result.toTextStreamResponse();
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
