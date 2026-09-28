// ============= Server-only: BYOK-Schlüssel, Anbieter-Adapter, zentrale KI-Auflösung =============
import { redactPii, redactionSummary } from "@/lib/pii";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { settingsFrom } from "@/lib/settings";
import { AI_PROVIDER_META, isAiProvider, type AiProvider } from "@/lib/ai-providers";
import {
  DEFAULT_ROUTE,
  type AiFunctionId,
  type AiRouteProvider,
  type AiRouting,
} from "@/lib/ai-functions";
import { estimateCost, estimateTokens } from "@/lib/ai-pricing";
import type { Database } from "@/integrations/supabase/types";

const GATEWAY = "https://ai.gateway.lovable.dev/v1";

export type AiKeyEntry = { key: string; baseUrl: string | null; modelHint: string | null };

export type AiKeyConfig = {
  userId: string;
  useByok: boolean;
  provider: AiProvider;
  keys: Partial<Record<AiProvider, AiKeyEntry>>;
  routing: AiRouting;
};

// ---------- Verschlüsselung ----------

function masterKey(): Buffer {
  const secret = process.env["AI_KEY_ENCRYPTION_SECRET"];
  if (!secret) throw new Error("AI_KEY_ENCRYPTION_SECRET fehlt");
  return createHash("sha256").update(secret).digest();
}

/** Verschlüsselt einen Schlüssel: base64(iv | authTag | cipher). */
export function encryptKey(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", masterKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64");
}

/** Entschlüsselt einen gespeicherten Schlüssel; wirft bei manipulierten Daten. */
export function decryptKey(packed: string): string {
  const raw = Buffer.from(packed, "base64");
  if (raw.length < 29) throw new Error("Gespeicherter Schlüssel ist beschädigt");
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const data = raw.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", masterKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}

// ---------- Konfiguration laden ----------

type DbClient = import("@supabase/supabase-js").SupabaseClient<Database>;

export async function loadAiKeyConfig(
  supabase: DbClient,
  userId: string,
): Promise<AiKeyConfig> {
  const [keysResult, profileResult] = await Promise.all([
    supabase
      .from("user_ai_keys")
      .select("provider,encrypted_key,base_url,model_hint")
      .eq("user_id", userId),
    supabase.from("profiles").select("settings").eq("id", userId),
  ]);

  const rows = (keysResult.data as
    | { provider: unknown; encrypted_key: string; base_url: string | null; model_hint: string | null }[]
    | null) ?? [];
  const profileRows = (profileResult.data as { settings: unknown }[] | null) ?? [];

  const keys: AiKeyConfig["keys"] = {};
  for (const row of rows) {
    if (!isAiProvider(row.provider)) continue;
    try {
      keys[row.provider] = {
        key: decryptKey(row.encrypted_key),
        baseUrl: row.base_url,
        modelHint: row.model_hint,
      };
    } catch {
      /* Beschädigter Eintrag wird ignoriert – Rückfallebene greift. */
    }
  }

  const settings = settingsFrom(profileRows[0]?.settings);
  return {
    userId,
    useByok: settings.useByok,
    provider: settings.byokProvider,
    keys,
    routing: settings.aiRouting,
  };
}

/** Für öffentliche App-Endpunkte: Konfiguration des App-Inhabers laden. */
export async function loadAiKeyConfigForOwner(userId: string): Promise<AiKeyConfig> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return loadAiKeyConfig(supabaseAdmin, userId);
}

// ---------- Hilfen ----------

function gatewayKey(): string {
  const key = process.env["LOVABLE_API_KEY"];
  if (!key) throw new Error("LOVABLE_API_KEY fehlt");
  return key;
}

function byokError(provider: AiProvider, status: number, detail: string): Error {
  const label = AI_PROVIDER_META[provider].label;
  return new Error(
    `Dein eigener KI-Anbieter (${label}) hat die Anfrage abgelehnt [${status}]: ${detail.slice(0, 300)}`,
  );
}

/** Entfernt Markdown-Zäune und schneidet auf das JSON-Objekt zurück. */
function cleanJsonText(text: string): string {
  let out = text.trim();
  const fence = out.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence?.[1]) out = fence[1].trim();
  const start = out.indexOf("{");
  const end = out.lastIndexOf("}");
  if (start > 0 || (end !== -1 && end < out.length - 1)) {
    if (start !== -1 && end > start) out = out.slice(start, end + 1);
  }
  return out;
}

/** Liest einen SSE-Stream und ruft für jedes data:-Event den Handler auf. */
async function readSse(
  response: Response,
  onEvent: (payload: string) => void,
): Promise<void> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (payload && payload !== "[DONE]") onEvent(payload);
    }
  }
}

async function errorMessage(response: Response): Promise<string> {
  try {
    const detail = await response.text();
    try {
      const parsed = JSON.parse(detail) as { error?: { message?: string }; message?: string };
      return parsed.error?.message ?? parsed.message ?? detail;
    } catch {
      return detail;
    }
  } catch {
    return response.statusText;
  }
}

// ---------- Gateway (Rückfallebene) ----------

async function gatewayResponses(req: {
  prompt: string;
  image?: string;
  schemaName: string;
  schema: Record<string, unknown>;
}): Promise<string> {
  const content: { type: string; text?: string; image_url?: string }[] = [
    { type: "input_text", text: req.prompt },
  ];
  if (req.image) content.push({ type: "input_image", image_url: req.image });

  const response = await fetch(`${GATEWAY}/responses`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "Lovable-API-Key": gatewayKey(),
      "X-Lovable-AIG-SDK": "fetch",
    },
    body: JSON.stringify({
      model: "openai/gpt-6-astra",
      input: req.image
        ? [{ role: "user", content }]
        : req.prompt,
      stream: true,
      store: false,
      reasoning: { effort: "low" },
      text: {
        format: {
          type: "json_schema",
          name: req.schemaName,
          strict: true,
          schema: req.schema,
        },
      },
    }),
  });

  if (response.status === 402) {
    throw new Error("Das KI-Guthaben ist aufgebraucht – bitte im Arbeitsbereich aufladen.");
  }
  if (response.status === 429) {
    throw new Error("Zu viele Anfragen gleichzeitig – bitte kurz warten und erneut versuchen.");
  }
  if (!response.ok || !response.body) {
    throw new Error(`KI-Analyse fehlgeschlagen [${response.status}]: ${(await errorMessage(response)).slice(0, 300)}`);
  }

  let text = "";
  await readSse(response, (payload) => {
    try {
      const event = JSON.parse(payload) as {
        type?: string;
        delta?: string;
        response?: { output_text?: string };
      };
      if (event.type === "response.output_text.delta" && event.delta) text += event.delta;
      if (event.type === "response.completed" && !text && event.response?.output_text) {
        text = event.response.output_text;
      }
    } catch {
      /* Teil-Event ignorieren */
    }
  });
  return text;
}

// ---------- Eigene Anbieter (BYOK) ----------

function anthropicImage(url: string): { type: "image"; source: Record<string, unknown> } | null {
  const dataMatch = url.match(/^data:([^;]+);base64,(.+)$/s);
  if (dataMatch) {
    return {
      type: "image",
      source: { type: "base64", media_type: dataMatch[1], data: dataMatch[2] },
    };
  }
  return { type: "image", source: { type: "url", url } };
}

async function openAiCompatibleStructured(
  provider: AiProvider,
  entry: AiKeyEntry,
  req: { prompt: string; image?: string; schemaName?: string; schema?: Record<string, unknown>; maxTokens?: number },
): Promise<string> {
  const meta = AI_PROVIDER_META[provider];
  const baseUrl = (entry.baseUrl || meta.baseUrl).replace(/\/+$/, "");
  const model = entry.modelHint?.trim() || meta.model;
  const content: Record<string, unknown>[] = [{ type: "text", text: req.prompt }];
  if (req.image) content.push({ type: "image_url", image_url: { url: req.image } });

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${entry.key}`,
      "HTTP-Referer": "https://scopebuilder.lovable.app",
      "X-Title": "scopebuilder",
    },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: req.image ? content : req.prompt }],
      stream: true,
      max_tokens: req.maxTokens ?? 4096,
      ...(req.schema
        ? {
            response_format: {
              type: "json_schema",
              json_schema: { name: req.schemaName ?? "result", strict: false, schema: req.schema },
            },
          }
        : {}),
    }),
  });

  if (!response.ok || !response.body) {
    throw byokError(provider, response.status, await errorMessage(response));
  }

  let text = "";
  await readSse(response, (payload) => {
    try {
      const event = JSON.parse(payload) as {
        choices?: { delta?: { content?: string } }[];
      };
      const delta = event.choices?.[0]?.delta?.content;
      if (delta) text += delta;
    } catch {
      /* Teil-Event ignorieren */
    }
  });
  return text;
}

async function anthropicStructured(
  entry: AiKeyEntry,
  req: { prompt: string; image?: string; schema?: Record<string, unknown>; maxTokens?: number },
): Promise<string> {
  const model = entry.modelHint?.trim() || AI_PROVIDER_META.anthropic.model;
  const prompt = req.schema
    ? `Antworte ausschließlich mit einem einzigen JSON-Objekt nach diesem JSON-Schema (keine Erklärung, kein Markdown):\n${JSON.stringify(req.schema)}\n\n${req.prompt}`
    : req.prompt;
  const blocks: Record<string, unknown>[] = [{ type: "text", text: prompt }];
  const image = req.image ? anthropicImage(req.image) : null;
  if (image) blocks.push(image);

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": entry.key,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: req.maxTokens ?? 4096,
      messages: [{ role: "user", content: blocks }],
      stream: true,
    }),
  });

  if (!response.ok || !response.body) {
    throw byokError("anthropic", response.status, await errorMessage(response));
  }

  let text = "";
  await readSse(response, (payload) => {
    try {
      const event = JSON.parse(payload) as {
        type?: string;
        delta?: { type?: string; text?: string };
      };
      if (event.type === "content_block_delta" && event.delta?.type === "text_delta" && event.delta.text) {
        text += event.delta.text;
      }
    } catch {
      /* Teil-Event ignorieren */
    }
  });
  return text;
}

async function googleFetchImage(url: string): Promise<{ mime: string; data: string }> {
  if (url.startsWith("data:")) {
    const match = url.match(/^data:([^;]+);base64,(.+)$/s);
    if (match) return { mime: match[1] ?? "image/png", data: match[2] ?? "" };
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Bild konnte nicht geladen werden (${res.status})`);
  const buffer = Buffer.from(await res.arrayBuffer());
  return {
    mime: res.headers.get("content-type")?.split(";")[0] || "image/jpeg",
    data: buffer.toString("base64"),
  };
}

async function googleStructured(
  entry: AiKeyEntry,
  req: { prompt: string; image?: string; schema?: Record<string, unknown>; maxTokens?: number },
): Promise<string> {
  const model = entry.modelHint?.trim() || AI_PROVIDER_META.google.model;
  const parts: Record<string, unknown>[] = [{ text: req.prompt }];
  if (req.image) {
    const img = await googleFetchImage(req.image);
    parts.push({ inline_data: { mime_type: img.mime, data: img.data } });
  }

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`,
    {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": entry.key },
      body: JSON.stringify({
        contents: [{ role: "user", parts }],
        generationConfig: {
          maxOutputTokens: req.maxTokens ?? 4096,
          ...(req.schema
            ? { response_mime_type: "application/json", response_schema: req.schema }
            : {}),
        },
      }),
    },
  );

  if (!response.ok || !response.body) {
    throw byokError("google", response.status, await errorMessage(response));
  }

  let text = "";
  await readSse(response, (payload) => {
    try {
      const event = JSON.parse(payload) as {
        candidates?: { content?: { parts?: { text?: string }[] } }[];
      };
      for (const part of event.candidates?.[0]?.content?.parts ?? []) {
        if (part.text) text += part.text;
      }
    } catch {
      /* Teil-Event ignorieren */
    }
  });
  return text;
}

// ---------- Zentrale Auflösung ----------

export type StructuredRequest = {
  /** Welche Funktion ruft an – steuert Anbieter- und Modellwahl. */
  fn: AiFunctionId;
  prompt: string;
  /** Bild als https-URL oder data-URL. */
  image?: string;
  schemaName: string;
  schema: Record<string, unknown>;
};

/** Löst die pro Funktion gewählte Anbieter-/Modellkombination auf. */
export function resolveRoute(
  cfg: AiKeyConfig,
  fn: AiFunctionId,
): { provider: AiRouteProvider; entry?: AiKeyEntry; model: string | null } {
  const route = cfg.routing?.[fn] ?? DEFAULT_ROUTE;
  if (!cfg.useByok || route.provider === "lovable") {
    return { provider: "lovable", model: null };
  }
  const entry = cfg.keys[route.provider];
  // Sicherer Fallback: ohne hinterlegten Schlüssel läuft es über Lovable AI.
  if (!entry) return { provider: "lovable", model: null };
  const model = route.model ?? entry.modelHint ?? AI_PROVIDER_META[route.provider].model;
  return { provider: route.provider, entry: { ...entry, modelHint: model }, model };
}

/** Schreibt einen Nutzungs-Datensatz; Fehler dabei dürfen die Anfrage nie stoppen. */
export async function recordUsage(entry: {
  userId: string;
  provider: AiRouteProvider;
  fn: string;
  model: string;
  inputText: string;
  outputText: string;
  ok: boolean;
}): Promise<void> {
  try {
    const inputTokens = estimateTokens(entry.inputText);
    const outputTokens = entry.outputText ? estimateTokens(entry.outputText) : 0;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.from("ai_usage").insert({
      user_id: entry.userId,
      provider: entry.provider,
      fn: entry.fn,
      model: entry.model,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      cost_usd: estimateCost(entry.provider, inputTokens, outputTokens),
      ok: entry.ok,
    });
  } catch {
    /* Nutzungserfassung ist optional */
  }
}

/**
 * Führt eine strukturierte KI-Anfrage aus: eigenes Anbieterkonto nach der
 * Auswahl je Funktion, sonst – und bei jedem Fehler des eigenen Anbieters –
 * der Lovable-KI-Zugang. Liefert bereinigten JSON-Text zurück.
 */
export async function runStructured(cfg: AiKeyConfig, input: StructuredRequest): Promise<string> {
  // Datenschutz-Filter: persönliche Daten und Schlüssel gehen nie an ein Modell.
  const redaction = redactPii(input.prompt, "strict");
  const req: StructuredRequest = { ...input, prompt: redaction.text };
  const summary = redactionSummary(redaction.counts);
  if (summary) console.info("ai privacy", req.fn, summary);
  const route = resolveRoute(cfg, req.fn);
  const promptSize = req.prompt + (req.image ? "x".repeat(2000) : "");

  const callProvider = async (): Promise<string> => {
    const entry = route.entry!;
    if (route.provider === "anthropic") return anthropicStructured(entry, req);
    if (route.provider === "google") return googleStructured(entry, req);
    // openai und openrouter sind OpenAI-kompatibel
    return openAiCompatibleStructured(route.provider as AiProvider, entry, req);
  };

  if (route.entry) {
    try {
      const text = await callProvider();
      await recordUsage({
        userId: cfg.userId,
        provider: route.provider,
        fn: req.fn,
        model: route.model ?? "",
        inputText: promptSize,
        outputText: text,
        ok: true,
      });
      return cleanJsonText(text);
    } catch {
      await recordUsage({
        userId: cfg.userId,
        provider: route.provider,
        fn: req.fn,
        model: route.model ?? "",
        inputText: promptSize,
        outputText: "",
        ok: false,
      });
      /* Sicherer Fallback auf den mitgelieferten Zugang */
    }
  }

  const text = await gatewayResponses(req);
  await recordUsage({
    userId: cfg.userId,
    provider: "lovable",
    fn: req.fn,
    model: "openai/gpt-6-astra",
    inputText: promptSize,
    outputText: text,
    ok: true,
  });
  return cleanJsonText(text);
}

// ---------- Transkription ----------

export type TranscriptionResult = { text: string; segments: { start: number; text: string }[] };

async function gatewayTranscription(bytes: ArrayBuffer, mime: string): Promise<TranscriptionResult> {
  const form = new FormData();
  form.append("file", new Blob([bytes], { type: mime }), "audio");
  form.append("model", "google/gemini-3.5-transcribe");
  form.append("response_format", "verbose_json");

  const response = await fetch(`${GATEWAY}/audio/transcriptions`, {
    method: "POST",
    headers: { "Lovable-API-Key": gatewayKey(), "X-Lovable-AIG-SDK": "fetch" },
    body: form,
  });
  if (!response.ok) {
    throw new Error(`Transkription fehlgeschlagen [${response.status}]: ${(await errorMessage(response)).slice(0, 400)}`);
  }
  const payload = (await response.json()) as {
    text?: string;
    segments?: { start?: number; text?: string }[];
  };
  const segments = (payload.segments ?? [])
    .map((s) => ({ start: Number(s.start ?? 0), text: (s.text ?? "").trim() }))
    .filter((line) => line.text);
  return { text: payload.text ?? "", segments };
}

async function openAiTranscription(
  entry: AiKeyEntry,
  bytes: ArrayBuffer,
  mime: string,
): Promise<TranscriptionResult> {
  const baseUrl = (entry.baseUrl || AI_PROVIDER_META.openai.baseUrl).replace(/\/+$/, "");
  const model = entry.modelHint?.trim() || "gpt-4o-mini-transcribe";
  const form = new FormData();
  form.append("file", new Blob([bytes], { type: mime }), "audio");
  form.append("model", model);
  form.append("response_format", "json");

  const response = await fetch(`${baseUrl}/audio/transcriptions`, {
    method: "POST",
    headers: { authorization: `Bearer ${entry.key}` },
    body: form,
  });
  if (!response.ok) {
    throw byokError("openai", response.status, await errorMessage(response));
  }
  const payload = (await response.json()) as { text?: string };
  return { text: payload.text ?? "", segments: [] };
}

async function googleTranscription(
  entry: AiKeyEntry,
  bytes: ArrayBuffer,
  mime: string,
): Promise<TranscriptionResult> {
  const model = entry.modelHint?.trim() || AI_PROVIDER_META.google.model;
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": entry.key },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [
              { text: "Transkribiere die Audiodatei vollständig und wörtlich. Gib nur den Text zurück." },
              {
                inline_data: {
                  mime_type: mime.startsWith("audio/") ? mime : "audio/mpeg",
                  data: Buffer.from(bytes).toString("base64"),
                },
              },
            ],
          },
        ],
      }),
    },
  );
  if (!response.ok) {
    throw byokError("google", response.status, await errorMessage(response));
  }
  const payload = (await response.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  const text =
    payload.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("") ?? "";
  return { text, segments: [] };
}

/**
 * Transkribiert Audio: eigener OpenAI- oder Google-Schlüssel, wenn BYOK aktiv
 * ist und der gewählte Anbieter Transkription unterstützt, sonst Lovable AI.
 */
export async function runTranscription(
  cfg: AiKeyConfig,
  audio: { bytes: ArrayBuffer; mime: string },
): Promise<TranscriptionResult> {
  const route = resolveRoute(cfg, "transcription");
  const size = "x".repeat(Math.min(audio.bytes.byteLength / 50, 200_000));

  if (route.entry && (route.provider === "openai" || route.provider === "google")) {
    try {
      const result =
        route.provider === "openai"
          ? await openAiTranscription(route.entry, audio.bytes, audio.mime)
          : await googleTranscription(route.entry, audio.bytes, audio.mime);
      await recordUsage({
        userId: cfg.userId,
        provider: route.provider,
        fn: "transcription",
        model: route.model ?? "",
        inputText: size,
        outputText: result.text,
        ok: true,
      });
      return result;
    } catch {
      await recordUsage({
        userId: cfg.userId,
        provider: route.provider,
        fn: "transcription",
        model: route.model ?? "",
        inputText: size,
        outputText: "",
        ok: false,
      });
      /* Sicherer Fallback auf den mitgelieferten Zugang */
    }
  }

  const fallback = await gatewayTranscription(audio.bytes, audio.mime);
  await recordUsage({
    userId: cfg.userId,
    provider: "lovable",
    fn: "transcription",
    model: "google/gemini-3.5-transcribe",
    inputText: size,
    outputText: fallback.text,
    ok: true,
  });
  return fallback;
}

// ---------- Verbindungs-Test ----------

/** Kleine echte Anfrage gegen den gespeicherten Schlüssel. */
export async function testProviderKey(
  provider: AiProvider,
  entry: AiKeyEntry,
): Promise<{ ok: boolean; message: string }> {
  const prompt = "Antworte mit genau einem Wort: Bereit";
  try {
    if (provider === "anthropic") {
      const text = await anthropicStructured(entry, { prompt, maxTokens: 32 });
      return { ok: text.trim().length > 0, message: "Verbindung erfolgreich" };
    }
    if (provider === "google") {
      const text = await googleStructured(entry, { prompt, maxTokens: 32 });
      return { ok: text.trim().length > 0, message: "Verbindung erfolgreich" };
    }
    const text = await openAiCompatibleStructured(provider, entry, { prompt, maxTokens: 32 });
    return { ok: text.trim().length > 0, message: "Verbindung erfolgreich" };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Verbindung fehlgeschlagen" };
  }
}

// ---------- Typen-Hilfe für generierte Supabase-Typen ----------

export type UserAiKeyRow = Database["public"]["Tables"]["user_ai_keys"]["Row"];
