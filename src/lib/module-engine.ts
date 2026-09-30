/**
 * Rechenkern-Bindung je Modul – logisch, portabel, ohne Geheimnisse.
 *
 * Ein Modul erklärt nur, WELCHE Art Rechenkern und WELCHES Modell es braucht
 * (z. B. „lokal / llama3.3“ oder „openrouter / deepseek-r1“). Wo dieser
 * Rechenkern physisch läuft (Adresse, Port) und womit er sich anmeldet
 * (Schlüssel), steht ausschließlich serverseitig in der Umgebung bzw. im
 * Tresor. Damit bleibt ein Bauplan zwischen Laptop, VPS und Kundensystem
 * austauschbar.
 *
 * Client-sicher: keine Server-Importe.
 */

export const ENGINE_PROVIDERS = [
  "default",
  "openrouter",
  "openai",
  "anthropic",
  "google",
  "local",
] as const;

export type EngineProvider = (typeof ENGINE_PROVIDERS)[number];

export const ENGINE_PROVIDER_META: Record<
  EngineProvider,
  { label: string; hint: string; needsKey: boolean }
> = {
  default: {
    label: "Standard (Server)",
    hint: "Nutzt den im Konto bzw. auf dem Server eingestellten Rechenkern.",
    needsKey: false,
  },
  openrouter: {
    label: "OpenRouter",
    hint: "Ein Schlüssel, hunderte Modelle – gut für unterschiedliche Agenten auf einem Canvas.",
    needsKey: true,
  },
  openai: { label: "OpenAI (direkt)", hint: "Eigener OpenAI-Schlüssel.", needsKey: true },
  anthropic: { label: "Anthropic (direkt)", hint: "Eigener Claude-Schlüssel.", needsKey: true },
  google: { label: "Google Gemini (direkt)", hint: "Eigener Gemini-Schlüssel.", needsKey: true },
  local: {
    label: "Lokaler Server (Ollama / vLLM)",
    hint: "Läuft auf derselben Maschine. Adresse und Port stellt der Server, nicht der Bauplan.",
    needsKey: false,
  },
};

/** Vorschläge je Anbieter; freie Eingabe bleibt immer möglich. */
export const MODEL_SUGGESTIONS: Record<EngineProvider, string[]> = {
  default: [],
  openrouter: [
    "deepseek/deepseek-r1",
    "anthropic/claude-3.7-sonnet",
    "openai/o3-mini",
    "google/gemini-2.5-flash",
    "meta-llama/llama-3.3-70b-instruct",
  ],
  openai: ["gpt-4o-mini", "gpt-4o", "o3-mini"],
  anthropic: ["claude-sonnet-4-5", "claude-3-7-sonnet"],
  google: ["gemini-flash-latest", "gemini-2.5-pro"],
  local: ["llama3.3", "qwen2.5:14b", "mistral", "deepseek-r1:14b"],
};

export type ModuleEngineBinding = {
  provider: EngineProvider;
  /** Modellkennung beim gewählten Rechenkern; leer = dessen Standard. */
  model: string | null;
  /** Eigenes Token-Budget dieses Moduls; null = Scope-/Systemdeckel. */
  maxTokens: number | null;
};

export const DEFAULT_ENGINE_BINDING: ModuleEngineBinding = {
  provider: "default",
  model: null,
  maxTokens: null,
};

export function isEngineProvider(value: unknown): value is EngineProvider {
  return typeof value === "string" && (ENGINE_PROVIDERS as readonly string[]).includes(value);
}

/** Liest die Bindung robust aus beliebigen Metadaten. */
export function readEngineBinding(metadata: unknown): ModuleEngineBinding {
  const meta = (metadata ?? {}) as Record<string, unknown>;
  const raw = meta["engine"];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ...DEFAULT_ENGINE_BINDING };
  const entry = raw as Record<string, unknown>;
  const provider = isEngineProvider(entry["provider"]) ? entry["provider"] : "default";
  const model =
    typeof entry["model"] === "string" && entry["model"].trim() ? entry["model"].trim() : null;
  const budget = Number(entry["maxTokens"]);
  const maxTokens =
    Number.isFinite(budget) && budget > 0 ? Math.min(Math.round(budget), 200_000) : null;
  return { provider, model, maxTokens };
}

/** Bindung für die Ablage in Metadaten; Standard ohne Angaben fällt weg. */
export function engineBindingToMetadata(
  binding: ModuleEngineBinding,
): Record<string, unknown> | null {
  if (binding.provider === "default" && !binding.model && !binding.maxTokens) return null;
  return {
    provider: binding.provider,
    ...(binding.model ? { model: binding.model } : {}),
    ...(binding.maxTokens ? { maxTokens: binding.maxTokens } : {}),
  };
}

/** Kurzbeschreibung für Übersichten und den Import-Check. */
export function describeEngine(binding: ModuleEngineBinding): string {
  const meta = ENGINE_PROVIDER_META[binding.provider];
  if (binding.provider === "default") return meta.label;
  return binding.model ? `${meta.label} · ${binding.model}` : meta.label;
}

/* ------------------------------------------------------------------ */
/* Fähigkeitsprüfung vor der Ausführung                                */
/* ------------------------------------------------------------------ */

export type EngineCapability = "structured" | "vision" | "tools" | "longContext";

export const CAPABILITY_LABEL: Record<EngineCapability, string> = {
  structured: "strukturierte Antwort (JSON)",
  vision: "Bilder verstehen",
  tools: "Werkzeuge aufrufen",
  longContext: "lange Inhalte (>100k Tokens)",
};

type Support = "yes" | "no" | "unknown";

/** Bekannte Eigenschaften über Muster der Modellkennung (ohne Anbieter-Präfix). */
const RULES: { match: RegExp; caps: Partial<Record<EngineCapability, Support>> }[] = [
  { match: /deepseek-r1|r1-distill/, caps: { structured: "no", tools: "no", vision: "no", longContext: "no" } },
  { match: /o[134]-mini|o3(?!-)/, caps: { structured: "yes", tools: "yes", vision: "no", longContext: "yes" } },
  { match: /gpt-4o|gpt-4\.1|gpt-5|gpt-6/, caps: { structured: "yes", tools: "yes", vision: "yes", longContext: "yes" } },
  { match: /claude/, caps: { structured: "yes", tools: "yes", vision: "yes", longContext: "yes" } },
  { match: /gemini/, caps: { structured: "yes", tools: "yes", vision: "yes", longContext: "yes" } },
  { match: /vision|llava|-vl|qwen2\.5vl|llama3\.2-vision/, caps: { vision: "yes", structured: "unknown", tools: "unknown" } },
  { match: /llama-?3\.3|llama3\.3|qwen2\.5|mistral/, caps: { structured: "yes", tools: "yes", vision: "no", longContext: "no" } },
];

export function modelSupport(binding: ModuleEngineBinding, cap: EngineCapability): Support {
  if (binding.provider === "default" || !binding.model) return "yes"; // Standard-Rechenkern kann alles Benötigte
  const id = binding.model.toLowerCase();
  for (const rule of RULES) {
    if (rule.match.test(id) && rule.caps[cap]) return rule.caps[cap]!;
  }
  return "unknown";
}

/** Passende Alternativen beim selben Anbieter, die alle Anforderungen sicher erfüllen. */
export function suggestAlternatives(
  binding: ModuleEngineBinding,
  required: EngineCapability[],
): string[] {
  return MODEL_SUGGESTIONS[binding.provider].filter(
    (model) =>
      model !== binding.model &&
      required.every((cap) => modelSupport({ ...binding, model }, cap) === "yes"),
  );
}

export type CompatibilityReport = {
  ok: boolean;
  missing: EngineCapability[];
  uncertain: EngineCapability[];
  alternatives: string[];
};

export function checkEngineCompatibility(
  binding: ModuleEngineBinding,
  required: EngineCapability[],
): CompatibilityReport {
  const missing = required.filter((cap) => modelSupport(binding, cap) === "no");
  const uncertain = required.filter((cap) => modelSupport(binding, cap) === "unknown");
  const alternatives =
    missing.length || uncertain.length ? suggestAlternatives(binding, required) : [];
  return { ok: missing.length === 0, missing, uncertain, alternatives };
}

export function compatibilityMessage(binding: ModuleEngineBinding, report: CompatibilityReport): string {
  const names = report.missing.map((cap) => CAPABILITY_LABEL[cap]).join(", ");
  const alt = report.alternatives.length
    ? ` Geeignet wären z. B.: ${report.alternatives.slice(0, 3).join(", ")} – oder „Standard".`
    : " Wähle ein anderes Modell oder „Standard".";
  return `Das Modell ${binding.model} unterstützt nicht: ${names}.${alt}`;
}
