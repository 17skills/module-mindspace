import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { loadAiKeyConfig, runStructured } from "@/lib/ai-keys.server";
import { ENGINE_PROVIDERS } from "@/lib/module-engine";
import { UNTRUSTED_NOTICE, wrapUntrusted } from "@/lib/untrusted";


const AgentResult = z.object({
  value: z.string(),
  unit: z.string(),
  reason: z.string(),
});

export type ZoneAgentResult = z.infer<typeof AgentResult>;

const RESULT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    value: { type: "string" },
    unit: { type: "string" },
    reason: { type: "string" },
  },
  required: ["value", "unit", "reason"],
} as const;

/**
 * A background field acts as an agent: it reads everything lying on it
 * and derives one result (number or short text) from its task.
 * Nutzt den eigenen KI-Schlüssel des Nutzers (BYOK), sonst Lovable AI.
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
        /** Rechenkern-Bindung des Feldes (Anbieterart + Modell, nie Schlüssel). */
        engine: z
          .object({
            provider: z.enum(ENGINE_PROVIDERS),
            model: z.string().max(200).nullable().default(null),
            maxTokens: z.number().int().min(1).max(200000).nullable().default(null),
          })
          .nullish(),
      })
      .parse(input),
  )

  .handler(async ({ data, context }) => {
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
- ${UNTRUSTED_NOTICE}

Inhalte des Feldes:
${wrapUntrusted(data.field, data.context.slice(0, 200_000))}`;

    const cfg = await loadAiKeyConfig(context.supabase, context.userId);
    const text = await runStructured(cfg, {
      fn: "agent",
      prompt,
      schemaName: "agent_result",
      schema: RESULT_SCHEMA,
    });

    try {
      return AgentResult.parse(JSON.parse(text));
    } catch {
      throw new Error("Der Agent hat kein verwertbares Ergebnis geliefert");
    }
  });
