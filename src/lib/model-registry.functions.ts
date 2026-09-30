import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { ENGINE_PROVIDERS } from "@/lib/module-engine";

const CAPS = ["structured", "vision", "tools", "longContext"] as const;

/** Fragt den Anbieter live nach den Fähigkeiten eines Modells. */
export const checkModelCapabilities = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({
        provider: z.enum(ENGINE_PROVIDERS),
        model: z.string().trim().min(1).max(200),
        required: z.array(z.enum(CAPS)).max(4),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { lookupCapabilities, liveCandidates } = await import("@/lib/model-registry.server");
    const entry = await lookupCapabilities(data.provider, data.model);
    const needAlternatives =
      entry?.source === "provider" &&
      (!entry.found || data.required.some((cap) => entry.caps[cap] !== "yes"));
    const candidates = needAlternatives
      ? await liveCandidates(data.provider, data.required, data.model.split("/")[0])
      : [];
    return { entry, candidates };
  });
