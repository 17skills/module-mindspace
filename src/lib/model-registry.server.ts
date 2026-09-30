/**
 * Anbieterbewusstes Fähigkeitsregister.
 * Fragt, wo möglich, den Anbieter selbst: OpenRouter veröffentlicht seine
 * Modellliste samt Parametern und Eingabearten ohne Schlüssel; ein lokaler
 * Ollama-Server beantwortet `/api/show`. Für OpenAI/Anthropic/Google gibt es
 * keine öffentliche Fähigkeitsabfrage – dort greifen die Namensmuster.
 * Ergebnisse werden 6 Stunden im Speicher gehalten.
 */
import type { EngineCapability, EngineProvider, ModelCapabilityEntry, Support } from "@/lib/module-engine";

const TTL = 6 * 60 * 60 * 1000;
const LONG_CONTEXT = 100_000;

type OpenRouterModel = {
  id: string;
  context_length?: number | null;
  supported_parameters?: string[];
  architecture?: { input_modalities?: string[] };
};

let openRouterCache: { at: number; models: Map<string, OpenRouterModel> } | null = null;
const localCache = new Map<string, { at: number; entry: ModelCapabilityEntry }>();

async function fetchJson(url: string, init?: RequestInit): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal, redirect: "manual" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function openRouterModels(): Promise<Map<string, OpenRouterModel> | null> {
  if (openRouterCache && Date.now() - openRouterCache.at < TTL) return openRouterCache.models;
  try {
    const json = (await fetchJson("https://openrouter.ai/api/v1/models")) as { data?: OpenRouterModel[] };
    const models = new Map((json.data ?? []).map((m) => [m.id.toLowerCase(), m]));
    if (models.size === 0) return null;
    openRouterCache = { at: Date.now(), models };
    return models;
  } catch {
    return openRouterCache?.models ?? null;
  }
}

export function openRouterEntry(model: OpenRouterModel | undefined): ModelCapabilityEntry {
  if (!model) return { source: "provider", found: false, caps: {} };
  const params = new Set(model.supported_parameters ?? []);
  const inputs = new Set(model.architecture?.input_modalities ?? []);
  const yn = (v: boolean): Support => (v ? "yes" : "no");
  const caps: Partial<Record<EngineCapability, Support>> = {
    structured: yn(params.has("response_format") || params.has("structured_outputs")),
    tools: yn(params.has("tools")),
    vision: yn(inputs.has("image")),
  };
  if (model.context_length) caps.longContext = yn(model.context_length >= LONG_CONTEXT);
  return { source: "provider", found: true, caps, contextLength: model.context_length ?? null };
}

async function localEntry(model: string): Promise<ModelCapabilityEntry | null> {
  const base = process.env["AI_LOCAL_BASE_URL"];
  if (!base) return null;
  const hit = localCache.get(model);
  if (hit && Date.now() - hit.at < TTL) return hit.entry;
  try {
    // Nur die vom Server gesetzte Adresse – nie eine Nutzereingabe.
    const root = base.replace(/\/v1\/?$/, "");
    const json = (await fetchJson(`${root}/api/show`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model }),
    })) as { capabilities?: string[]; model_info?: Record<string, unknown> };
    const caps = new Set(json.capabilities ?? []);
    const ctxKey = Object.keys(json.model_info ?? {}).find((k) => k.endsWith(".context_length"));
    const ctx = ctxKey ? Number(json.model_info![ctxKey]) : null;
    const entry: ModelCapabilityEntry = {
      source: "provider",
      found: true,
      caps: {
        vision: caps.has("vision") ? "yes" : caps.size ? "no" : "unknown",
        tools: caps.has("tools") ? "yes" : caps.size ? "no" : "unknown",
        // Ollama erzwingt JSON-Schemata für jedes Modell über `format`.
        structured: caps.has("completion") ? "yes" : "unknown",
        ...(ctx ? { longContext: ctx >= LONG_CONTEXT ? "yes" : "no" } : {}),
      },
      contextLength: ctx,
    };
    localCache.set(model, { at: Date.now(), entry });
    return entry;
  } catch {
    return null; // Kein Ollama oder anderer Server (vLLM) – Namensmuster greifen.
  }
}

/** Live-Angaben zu einem Modell; `null` = Anbieter bietet keine Abfrage. */
export async function lookupCapabilities(
  provider: EngineProvider,
  model: string,
): Promise<ModelCapabilityEntry | null> {
  if (provider === "openrouter") {
    const models = await openRouterModels();
    return models ? openRouterEntry(models.get(model.toLowerCase())) : null;
  }
  if (provider === "local") return localEntry(model);
  return null;
}

/** Aktuelle Alternativen vom Anbieter, die alle Anforderungen sicher erfüllen. */
export async function liveCandidates(
  provider: EngineProvider,
  required: EngineCapability[],
  preferPrefix?: string,
): Promise<string[]> {
  if (provider !== "openrouter") return [];
  const models = await openRouterModels();
  if (!models) return [];
  const fits = [...models.values()].filter((m) => {
    const e = openRouterEntry(m);
    return required.every((cap) => e.caps[cap] === "yes");
  });
  const prefix = preferPrefix?.toLowerCase();
  fits.sort((a, b) => Number(b.id.startsWith(prefix ?? "\0")) - Number(a.id.startsWith(prefix ?? "\0")));
  return fits.slice(0, 5).map((m) => m.id);
}
