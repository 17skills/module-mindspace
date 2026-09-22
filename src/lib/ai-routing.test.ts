import { describe, expect, it } from "vitest";
import { defaultRouting, routingFrom } from "@/lib/ai-functions";
import { estimateCost, estimateTokens } from "@/lib/ai-pricing";
import { resolveRoute, type AiKeyConfig } from "@/lib/ai-keys.server";

const entry = { key: "k", baseUrl: null, modelHint: null };

function cfg(patch: Partial<AiKeyConfig> = {}): AiKeyConfig {
  return {
    userId: "u1",
    useByok: true,
    provider: "openai",
    keys: { openai: entry },
    routing: defaultRouting(),
    ...patch,
  };
}

describe("Anbieterwahl je Funktion", () => {
  it("nutzt ohne Auswahl den Lovable-Zugang", () => {
    expect(resolveRoute(cfg(), "agent").provider).toBe("lovable");
  });

  it("nutzt den gewählten Anbieter samt Modell", () => {
    const routing = defaultRouting();
    routing.agent = { provider: "openai", model: "gpt-4.1-mini" };
    const route = resolveRoute(cfg({ routing }), "agent");
    expect(route.provider).toBe("openai");
    expect(route.model).toBe("gpt-4.1-mini");
  });

  it("fällt ohne hinterlegten Schlüssel sicher auf Lovable zurück", () => {
    const routing = defaultRouting();
    routing.vision = { provider: "anthropic", model: null };
    expect(resolveRoute(cfg({ routing }), "vision").provider).toBe("lovable");
  });

  it("ignoriert die Auswahl, wenn BYOK ausgeschaltet ist", () => {
    const routing = defaultRouting();
    routing.factor = { provider: "openai", model: null };
    expect(resolveRoute(cfg({ routing, useByok: false }), "factor").provider).toBe("lovable");
  });
});

describe("Kostenschätzung", () => {
  it("liest gespeicherte Routen robust ein", () => {
    const parsed = routingFrom({ agent: { provider: "google", model: " gemini-x " } });
    expect(parsed.agent).toEqual({ provider: "google", model: "gemini-x" });
    expect(parsed.vision.provider).toBe("lovable");
  });

  it("schätzt Kosten aus Token-Mengen", () => {
    expect(estimateTokens("abcd".repeat(1000))).toBe(1000);
    expect(estimateCost("openai", 1_000_000, 1_000_000)).toBeCloseTo(0.75, 5);
  });
});
