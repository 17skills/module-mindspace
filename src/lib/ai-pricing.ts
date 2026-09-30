/** Grobe Preis-Schätzung je Anbieter – client-sicher, nur für Hinweise. */
import type { AiRouteProvider } from "@/lib/ai-functions";

/** US-Dollar je 1 Mio. Zeichen-Token (Eingabe/Ausgabe), bewusst konservativ. */
export const PRICE_PER_MTOK: Record<AiRouteProvider, { in: number; out: number }> = {
  lovable: { in: 0.5, out: 2.0 },
  openai: { in: 0.15, out: 0.6 },
  anthropic: { in: 3.0, out: 15.0 },
  google: { in: 0.3, out: 2.5 },
  openrouter: { in: 0.5, out: 1.5 },
};

/** Sehr grobe Token-Schätzung, wenn der Anbieter keine Nutzung meldet. */
export function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

export function estimateCost(
  provider: AiRouteProvider | string,
  inputTokens: number,
  outputTokens: number,
): number {
  // Lokale Modelle laufen auf eigener Hardware – keine Abrechnung je Token.
  if (provider === "local") return 0;
  const price = PRICE_PER_MTOK[provider as AiRouteProvider] ?? PRICE_PER_MTOK.lovable;
  const value = (inputTokens / 1_000_000) * price.in + (outputTokens / 1_000_000) * price.out;
  return Math.round(value * 1_000_000) / 1_000_000;
}


export function formatCost(value: number): string {
  return `${value.toFixed(value < 1 ? 4 : 2)} $`;
}
