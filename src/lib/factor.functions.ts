import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { loadAiKeyConfig, runStructured } from "@/lib/ai-keys.server";

const WeightResult = z.object({
  params: z.array(
    z.object({
      label: z.string(),
      weight: z.number(),
      score: z.number(),
      reason: z.string(),
    }),
  ),
  reason: z.string(),
});

export type FactorWeightResult = z.infer<typeof WeightResult>;

const RESULT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    params: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          label: { type: "string" },
          weight: { type: "number" },
          score: { type: "number" },
          reason: { type: "string" },
        },
        required: ["label", "weight", "score", "reason"],
      },
    },
    reason: { type: "string" },
  },
  required: ["params", "reason"],
} as const;

/**
 * The decision engine proposes a weighting: every parameter of a factor card
 * gets a share of 100 % and a condition score on the 1..10 scale.
 * Nutzt den eigenen KI-Schlüssel des Nutzers (BYOK), sonst Lovable AI.
 */
export const suggestFactorWeights = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({
        title: z.string().min(1),
        context: z.string().default(""),
        params: z
          .array(z.object({ label: z.string(), weight: z.number(), score: z.number() }))
          .min(1),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const list = data.params
      .map((param, index) => `${index + 1}. ${param.label} (aktuell ${param.weight} %, Zustand ${param.score}/10)`)
      .join("\n");

    const prompt = `Du bewertest den Risiko-Faktor „${data.title}“ eines Energienetz-Asset-Managements nach ISO 55001 / ISO 31000.

Parameter des Faktors:
${list}

Aufgabe:
- Vergib jedem Parameter ein Gewicht in Prozent. Die Summe aller Gewichte muss exakt 100 ergeben.
- Vergib jedem Parameter einen Zustandswert von 1 bis 10 (1 = unkritisch, 10 = akut kritisch). Behalte plausible bestehende Werte bei.
- "reason" je Parameter: ein kurzer Satz, warum dieses Gewicht fachlich angemessen ist.
- Das abschließende "reason" fasst die Gesamtgewichtung in zwei Sätzen zusammen.
- Erfinde keine Parameter und ändere die Reihenfolge nicht. Gib genau ${data.params.length} Parameter zurück.

Weiterer Kontext:
${data.context.slice(0, 40_000)}`;

    const cfg = await loadAiKeyConfig(context.supabase, context.userId);
    const text = await runStructured(cfg, {
      fn: "factor",
      prompt,
      schemaName: "factor_weights",
      schema: RESULT_SCHEMA,
    });

    try {
      return WeightResult.parse(JSON.parse(text));
    } catch {
      throw new Error("Es kam keine verwertbare Gewichtung zurück");
    }
  });
