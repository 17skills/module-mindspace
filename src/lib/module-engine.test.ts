import { describe, expect, it } from "vitest";
import { resolveRoute, type AiKeyConfig } from "@/lib/ai-keys.server";
import { engineBindingToMetadata, readEngineBinding } from "@/lib/module-engine";
import { engineRequirements } from "@/lib/runtime/manifest";
import type { ScopeManifest } from "@/lib/runtime/manifest";

const cfg = (keys: Record<string, { key: string; baseUrl: string; modelHint: string }>) =>
  ({ useByok: true, keys, routing: {} }) as unknown as AiKeyConfig;

const entry = (key: string) => ({ key, baseUrl: "", modelHint: "" });


describe("Rechenkern am Modul", () => {
  it("liest und schreibt die Bindung geheimnisfrei", () => {
    const meta = engineBindingToMetadata({
      provider: "openrouter",
      model: "deepseek/deepseek-r1",
      maxTokens: 16000,
    });
    expect(meta).toEqual({
      provider: "openrouter",
      model: "deepseek/deepseek-r1",
      maxTokens: 16000,
    });
    expect(readEngineBinding({ engine: meta })).toEqual({
      provider: "openrouter",
      model: "deepseek/deepseek-r1",
      maxTokens: 16000,
    });
    // Standard ohne Angaben belegt keinen Platz im Bauplan.
    expect(engineBindingToMetadata({ provider: "default", model: null, maxTokens: null })).toBeNull();
  });

  it("bevorzugt die Modul-Bindung vor dem Profil-Routing", () => {
    const route = resolveRoute(
      cfg({ openrouter: { key: "sk-or-test" } }),
      "agent",
      { provider: "openrouter", model: "deepseek/deepseek-r1", maxTokens: null },
    );
    expect(route.provider).toBe("openrouter");
    expect(route.model).toBe("deepseek/deepseek-r1");
  });

  it("fällt ohne hinterlegten Schlüssel sauber auf den Standard zurück", () => {
    const route = resolveRoute(cfg({}), "agent", {
      provider: "anthropic",
      model: "claude-3-7-sonnet",
      maxTokens: null,
    });
    expect(route.provider).toBe("lovable");
  });

  it("nutzt den lokalen Server nur aus der Server-Umgebung", () => {
    delete process.env["AI_LOCAL_BASE_URL"];
    const binding = { provider: "local" as const, model: "llama3.3", maxTokens: null };
    expect(resolveRoute(cfg({}), "agent", binding).provider).toBe("lovable");

    process.env["AI_LOCAL_BASE_URL"] = "http://127.0.0.1:11434/v1";
    const route = resolveRoute(cfg({}), "agent", binding);
    expect(route.provider).toBe("local");
    expect(route.entry?.baseUrl).toBe("http://127.0.0.1:11434/v1");
    delete process.env["AI_LOCAL_BASE_URL"];
  });

  it("fasst die geforderten Rechenkerne für den Import zusammen", () => {
    const manifest = {
      modules: [
        { engine: { provider: "openrouter", model: "deepseek/deepseek-r1" } },
        { engine: { provider: "openrouter", model: "deepseek/deepseek-r1" } },
        { engine: { provider: "local", model: "llama3.3" } },
        { engine: { provider: "default" } },
        {},
      ],
    } as unknown as ScopeManifest;
    const list = engineRequirements(manifest);
    expect(list).toHaveLength(2);
    expect(list[0]).toContain("2 Module");
    expect(list.join(" ")).toContain("llama3.3");
  });
});
