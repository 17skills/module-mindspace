import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

export type { InspectionAssessment } from "@/lib/inspection-vision.server";

/**
 * Assesses one inspection photo of a substation together with its report text
 * and returns a priority from 1 (act now) to 10 (cosmetic).
 */
export const analyzeInspection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({
        image: z.string().min(32),
        label: z.string().default(""),
        report: z.string().default(""),
        rates: z.string().default(""),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { assessPhoto } = await import("@/lib/inspection-vision.server");
    const { loadAiKeyConfig } = await import("@/lib/ai-keys.server");
    const cfg = await loadAiKeyConfig(context.supabase, context.userId);
    return assessPhoto(data, cfg);
  });
