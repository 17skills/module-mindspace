import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const GATEWAY = "https://ai.gateway.lovable.dev/v1";

function apiKey() {
  const key = process.env["LOVABLE_API_KEY"];
  if (!key) throw new Error("LOVABLE_API_KEY fehlt");
  return key;
}

const AgentResult = z.object({
  value: z.string(),
  unit: z.string(),
  reason: z.string(),
});

export type ZoneAgentResult = z.infer<typeof AgentResult>;

/**
 * A background field acts as an agent: it reads everything lying on it
 * and derives one result (number or short text) from its task.
 */
export const runZoneAgent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({
        field: z.string().min(1),
        task: z.string().min(1),
        kind: z.enum(["number", "text"]),
        unit: z.string().optional(),
        context: z.string().min(1),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const numberRule =
      data.kind === "number"
        ? `- "value" ist eine reine Zahl ohne Tausenderpunkte und ohne Einheit (Dezimaltrennzeichen: Punkt).
- "unit" ist die Einheit${data.unit ? ` (verwende „${data.unit}“)` : ""}.
- Wenn sich keine belastbare Zahl ableiten lässt, gib "value" als leeren Text zurück und erkläre das in "reason".`
        : `- "value" ist eine kurze Antwort in höchstens zwei Sätzen.
- "unit" bleibt leer.`;

    const prompt = `Du bist der Agent des Canvas-Feldes „${data.field}“. Auf diesem Feld liegen die unten stehenden Inhalte – sie sind dein gesamter Kontext.

Aufgabe: ${data.task}

Regeln:
${numberRule}
- "reason" begründet das Ergebnis in ein bis drei Sätzen und nennt, auf welche Inhalte du dich stützt.
- Erfinde keine Zahlen. Leite alles aus den Inhalten ab; wenn du schätzt, sage es in "reason".

Inhalte des Feldes:
${data.context.slice(0, 200_000)}`;

    const response = await fetch(`${GATEWAY}/responses`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "Lovable-API-Key": apiKey(),
        "X-Lovable-AIG-SDK": "fetch",
      },
      body: JSON.stringify({
        model: "openai/gpt-6-astra",
        input: prompt,
        stream: true,
        store: false,
        reasoning: { effort: "low" },
        text: {
          format: {
            type: "json_schema",
            name: "agent_result",
            strict: true,
            schema: {
              type: "object",
              additionalProperties: false,
              properties: {
                value: { type: "string" },
                unit: { type: "string" },
                reason: { type: "string" },
              },
              required: ["value", "unit", "reason"],
            },
          },
        },
      }),
    });

    if (!response.ok || !response.body) {
      const detail = await response.text();
      throw new Error(`Analyse fehlgeschlagen [${response.status}]: ${detail.slice(0, 300)}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let text = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;
        try {
          const event = JSON.parse(payload) as {
            type?: string;
            delta?: string;
            response?: { output_text?: string };
          };
          if (event.type === "response.output_text.delta" && event.delta) text += event.delta;
          if (event.type === "response.completed" && !text && event.response?.output_text) {
            text = event.response.output_text;
          }
        } catch {
          /* Teil-Event ignorieren */
        }
      }
    }

    try {
      return AgentResult.parse(JSON.parse(text));
    } catch {
      throw new Error("Der Agent hat kein verwertbares Ergebnis geliefert");
    }
  });
