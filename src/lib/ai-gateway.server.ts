import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createOpenAI } from "@ai-sdk/openai";

const GATEWAY_BASE = "https://ai.gateway.lovable.dev/v1";

export const CHAT_MODELS = [
  { id: "openai/gpt-6-astra", label: "GPT-6 Astra (Standard)" },
  { id: "openai/gpt-5.6-terra", label: "GPT-5.6 Terra (schnell)" },
  { id: "google/gemini-3.8-flash", label: "Gemini 3.8 Flash (günstig)" },
] as const;

export function lovableApiKey(): string {
  const key = process.env["LOVABLE_API_KEY"];
  if (!key) throw new Error("LOVABLE_API_KEY fehlt");
  return key;
}

export function responsesModel(modelId: string) {
  const key = lovableApiKey();
  const provider = createOpenAI({
    baseURL: GATEWAY_BASE,
    apiKey: key,
    headers: { "Lovable-API-Key": key, "X-Lovable-AIG-SDK": "vercel-ai-sdk" },
  });
  return provider.responses(modelId);
}

export function chatModel(modelId: string) {
  const key = lovableApiKey();
  const provider = createOpenAICompatible({
    name: "lovable",
    baseURL: GATEWAY_BASE,
    headers: { "Lovable-API-Key": key, "X-Lovable-AIG-SDK": "vercel-ai-sdk" },
  });
  return provider(modelId);
}

export function isOpenAiModel(modelId: string) {
  return modelId.startsWith("openai/");
}
