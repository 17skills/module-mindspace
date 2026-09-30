import { describe, expect, it } from "vitest";
import { openRouterEntry } from "@/lib/model-registry.server";
import { checkEngineCompatibility } from "@/lib/module-engine";

const binding = { provider: "openrouter" as const, model: "acme/brand-new-7", maxTokens: null };

describe("Anbieterbewusstes Register", () => {
  it("prüft ein unbekanntes neues Modell anhand der Anbieterangaben", () => {
    const live = openRouterEntry({
      id: "acme/brand-new-7",
      context_length: 200000,
      supported_parameters: ["tools", "response_format"],
      architecture: { input_modalities: ["text", "image"] },
    });
    const r = checkEngineCompatibility(binding, ["structured", "vision"], live);
    expect(r.ok).toBe(true);
    expect(r.uncertain).toHaveLength(0);
    expect(r.source).toBe("provider");
  });

  it("Anbieterangabe schlägt Namensmuster", () => {
    const live = openRouterEntry({ id: "x/gpt-6-tiny", supported_parameters: [] });
    const r = checkEngineCompatibility({ ...binding, model: "x/gpt-6-tiny" }, ["structured"], live);
    expect(r.ok).toBe(false);
  });

  it("meldet unbekannte Modelle und nutzt Live-Alternativen", () => {
    const r = checkEngineCompatibility(binding, ["structured"], openRouterEntry(undefined), [
      "anthropic/claude-3.7-sonnet",
    ]);
    expect(r.notFound).toBe(true);
    expect(r.alternatives).toContain("anthropic/claude-3.7-sonnet");
  });
});
