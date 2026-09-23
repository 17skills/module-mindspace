/** Katalog der KI-Funktionen – client-sicher, ohne Server-Imports. */
import { AI_PROVIDERS, type AiProvider } from "@/lib/ai-providers";

export const AI_FUNCTIONS = [
  {
    id: "agent",
    label: "Feld-Agenten",
    hint: "Analyse der Inhalte eines Hintergrundfeldes",
    kind: "structured",
  },
  {
    id: "factor",
    label: "Faktor-Vorschläge",
    hint: "Gewichte, Bewertungen und Plausibilität",
    kind: "structured",
  },
  {
    id: "extract",
    label: "Struktur-Extraktion",
    hint: "Kennzahlen und Struktur aus Dokumenten und Texten",
    kind: "structured",
  },
  {
    id: "vision",
    label: "Foto-Bewertung",
    hint: "Befunde und Zustand aus Fotos der Inspektions-Apps",
    kind: "structured",
  },
  {
    id: "decision",
    label: "JEV-Entscheidungen",
    hint: "Typisierte Entscheidungen: Auswahl, Bewertung, Ja/Nein mit Sicherheitswert",
    kind: "structured",
  },
  {
    id: "transcription",
    label: "Audio-Transkription",
    hint: "Sprache zu Text",
    kind: "transcription",
  },
] as const;

/** Modell des mitgelieferten Zugangs für typisierte Entscheidungen. */
export const JEV_MODEL = "typesafe/jev-latest";

export type AiFunctionId = (typeof AI_FUNCTIONS)[number]["id"];

/** "lovable" = mitgelieferter Zugang (Lovable AI). */
export type AiRouteProvider = "lovable" | AiProvider;

export type AiRoute = { provider: AiRouteProvider; model: string | null };

export type AiRouting = Record<AiFunctionId, AiRoute>;

export const DEFAULT_ROUTE: AiRoute = { provider: "lovable", model: null };

export function defaultRouting(): AiRouting {
  return Object.fromEntries(
    AI_FUNCTIONS.map((fn) => [fn.id, { ...DEFAULT_ROUTE }]),
  ) as AiRouting;
}

export function isAiFunctionId(value: unknown): value is AiFunctionId {
  return (
    typeof value === "string" && AI_FUNCTIONS.some((fn) => fn.id === value)
  );
}

export function isRouteProvider(value: unknown): value is AiRouteProvider {
  return (
    value === "lovable" ||
    (typeof value === "string" && (AI_PROVIDERS as readonly string[]).includes(value))
  );
}

/** Liest eine gespeicherte Routing-Konfiguration robust ein. */
export function routingFrom(value: unknown): AiRouting {
  const raw = (value ?? {}) as Record<string, unknown>;
  const out = defaultRouting();
  for (const fn of AI_FUNCTIONS) {
    const entry = raw[fn.id] as { provider?: unknown; model?: unknown } | undefined;
    if (!entry) continue;
    if (isRouteProvider(entry.provider)) out[fn.id].provider = entry.provider;
    out[fn.id].model =
      typeof entry.model === "string" && entry.model.trim() ? entry.model.trim() : null;
  }
  return out;
}
