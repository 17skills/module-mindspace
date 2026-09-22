/** KI-Anbieter für eigene Schlüssel (BYOK) – client-sicher, ohne Server-Imports. */
export const AI_PROVIDERS = ["openai", "anthropic", "google", "openrouter"] as const;

export type AiProvider = (typeof AI_PROVIDERS)[number];

export const AI_PROVIDER_META: Record<
  AiProvider,
  {
    label: string;
    /** Voreingestelltes Modell beim eigenen Anbieter; über Modell-Hinweis überschreibbar. */
    model: string;
    baseUrl: string;
    keyPlaceholder: string;
    supportsTranscription: boolean;
  }
> = {
  openai: {
    label: "OpenAI",
    model: "gpt-4o-mini",
    baseUrl: "https://api.openai.com/v1",
    keyPlaceholder: "sk-…",
    supportsTranscription: true,
  },
  anthropic: {
    label: "Anthropic (Claude)",
    model: "claude-sonnet-4-5",
    baseUrl: "https://api.anthropic.com",
    keyPlaceholder: "sk-ant-…",
    supportsTranscription: false,
  },
  google: {
    label: "Google Gemini",
    model: "gemini-flash-latest",
    baseUrl: "https://generativelanguage.googleapis.com",
    keyPlaceholder: "AIza…",
    supportsTranscription: true,
  },
  openrouter: {
    label: "OpenRouter / eigene Adresse",
    model: "openai/gpt-4o-mini",
    baseUrl: "https://openrouter.ai/api/v1",
    keyPlaceholder: "sk-or-…",
    supportsTranscription: false,
  },
};

export function isAiProvider(value: unknown): value is AiProvider {
  return typeof value === "string" && (AI_PROVIDERS as readonly string[]).includes(value);
}
