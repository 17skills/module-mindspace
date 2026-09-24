import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { recordUsage } from "@/lib/ai-keys.server";
import { JEV_MODEL } from "@/lib/ai-functions";

const GATEWAY = "https://ai.gateway.lovable.dev/v1";

export type FactorWeightResult = {
  params: { label: string; weight: number; score: number; reason: string; confidence: number | null }[];
  reason: string;
};

type JevAnswer = {
  choice?: string;
  score?: number;
  probabilities?: Record<string, number>;
  confidence?: number;
};

const CONDITION_LEVELS = [
  "Unkritisch: kein Hinweis auf Probleme, voll funktionsfähig.",
  "Leicht auffällig: einzelne Hinweise, aber ohne Handlungsbedarf.",
  "Beobachten: erkennbare Schwächen, Maßnahme mittelfristig nötig.",
  "Kritisch: deutliche Mängel, Maßnahme kurzfristig nötig.",
  "Akut kritisch: Ausfall oder Gefährdung droht unmittelbar.",
].map((description) => ({ description }));

async function askJev(
  key: string,
  state: Record<string, unknown>,
  questions: Record<string, unknown>,
  userId: string,
): Promise<Record<string, JevAnswer>> {
  const body = JSON.stringify({ model: JEV_MODEL, state, questions });
  const response = await fetch(`${GATEWAY}/systemone`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${key}`,
      "X-Lovable-AIG-SDK": "fetch",
    },
    body,
  });
  if (!response.ok) {
    const detail = await response.text();
    await recordUsage({ userId, provider: "lovable", fn: "decision", model: JEV_MODEL, inputText: body, outputText: "", ok: false });
    throw new Error(`JEV-Bewertung fehlgeschlagen [${response.status}]: ${detail.slice(0, 300)}`);
  }
  const payload = (await response.json()) as { answers?: Record<string, JevAnswer> };
  await recordUsage({ userId, provider: "lovable", fn: "decision", model: JEV_MODEL, inputText: body, outputText: JSON.stringify(payload.answers ?? {}), ok: true });
  return payload.answers ?? {};
}

/**
 * JEV bewertet einen Faktor in Runden:
 * 1. Alle Parameter zur Auswahl — JEV wählt den wichtigsten.
 * 2. Der Gewählte fällt heraus, die Frage wird mit dem Rest wiederholt.
 * So entsteht eine Rangfolge; das Gewicht rechnet die App aus dem Rang.
 * Den Zustand bewertet JEV je Parameter einzeln (Skala 1–10).
 * Wirksam wird nichts, bevor der Entscheider übernimmt oder überschreibt.
 */
export const suggestFactorWeights = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({
        title: z.string().min(1),
        context: z.string().default(""),
        params: z
          .array(z.object({ label: z.string(), weight: z.number(), score: z.number() }))
          .min(1)
          .max(40),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<FactorWeightResult> => {
    const key = process.env["LOVABLE_API_KEY"];
    if (!key) throw new Error("LOVABLE_API_KEY fehlt");

    const labels = data.params.map((param) => param.label);
    const state = {
      faktor: data.title,
      bereich: "Risiko-Faktor im Asset-Management eines Energienetzes (ISO 55001 / ISO 31000)",
      parameter: labels,
      kontext: data.context.slice(0, 40_000),
    };

    const rankQuestion = (remaining: number[]) => ({
      type: "choice",
      instructions: `Welcher der folgenden Parameter trägt am stärksten zum Faktor \`faktor\` bei? Nutze \`kontext\`, falls vorhanden.`,
      criteria: Object.fromEntries(remaining.map((index) => [`p${index}`, labels[index]!])),
    });

    // Runde 1: erste Rangfrage + alle Zustandsfragen (unabhängig, also gemeinsam).
    const first: Record<string, unknown> = {};
    labels.forEach((label, index) => {
      first[`s${index}`] = {
        type: "score",
        instructions: `Wie kritisch ist der Zustand des Parameters „${label}“ für den Faktor \`faktor\`? Stütze dich auf \`kontext\`; ohne Hinweise dort bewerte zurückhaltend.`,
        criteria: CONDITION_LEVELS,
      };
    });

    let remaining = labels.map((_, index) => index);
    const ranking: { index: number; confidence: number | null; why: string }[] = [];
    let scores: Record<string, JevAnswer> = {};

    while (remaining.length > 1) {
      const questions: Record<string, unknown> = { rank: rankQuestion(remaining) };
      if (!ranking.length) Object.assign(questions, first);
      const answers = await askJev(key, state, questions, context.userId);
      if (!ranking.length) scores = answers;
      const rank = answers["rank"];
      const winner = Number((rank?.choice ?? "").replace(/^p/, ""));
      if (!rank || !remaining.includes(winner)) {
        throw new Error("JEV hat keine gültige Auswahl zurückgegeben");
      }
      // Begründung: Wie knapp war die Wahl? (Zweitplatzierter aus den Wahrscheinlichkeiten)
      let runnerUp = "";
      const probs = rank.probabilities ?? {};
      const others = Object.entries(probs)
        .filter(([key]) => key !== rank.choice)
        .map(([key, p]) => ({ key, p }))
        .sort((a, b) => b.p - a.p);
      const second = others[0];
      if (second) {
        const secondIndex = Number(second.key.replace(/^p/, ""));
        const secondLabel = Number.isFinite(secondIndex) ? labels[secondIndex] : second.key;
        const gap = Math.round(((probs[rank.choice!] ?? 0) - second.p) * 100);
        runnerUp = gap > 5 ? `deutlich vor ${secondLabel}` : `knapp vor ${secondLabel} (${Math.round(second.p * 100)} %)`;
      }
      ranking.push({ index: winner, confidence: typeof rank.confidence === "number" ? rank.confidence : null, why: runnerUp });
      remaining = remaining.filter((index) => index !== winner);
    }
    if (remaining.length === 1) {
      ranking.push({ index: remaining[0]!, confidence: null, why: "übrig geblieben" });
    }
    if (labels.length === 1) {
      scores = await askJev(key, state, first, context.userId);
    }

    // Gewicht aus dem Rang (Rangsummen-Verfahren): Platz 1 von 4 → 40 %, dann 30, 20, 10.
    const n = ranking.length;
    const denom = (n * (n + 1)) / 2;
    const weights = ranking.map((_, place) => Math.round(((n - place) / denom) * 1000) / 10);
    const rest = Math.round((100 - weights.reduce((sum, w) => sum + w, 0)) * 10) / 10;
    if (weights.length) weights[0] = Math.round((weights[0]! + rest) * 10) / 10;

    const params = labels.map((label, index) => {
      const place = ranking.findIndex((item) => item.index === index);
      const item = ranking[place];
      const raw = scores[`s${index}`]?.score;
      const level = typeof raw === "number" ? Math.round(raw) : null;
      const score = level != null ? Math.round((1 + (raw! / 4) * 9) * 2) / 2 : data.params[index]!.score;
      const confidence = item?.confidence ?? null;
      const parts = [
        `Platz ${place + 1} von ${labels.length}`,
        confidence != null ? `${Math.round(confidence * 100)} % sicher` : null,
        item?.why || null,
        level != null
          ? `Zustand: ${CONDITION_LEVELS[Math.min(4, Math.max(0, level))]?.description.split(":")[0]} (${score} / 10)`
          : "Zustand nicht bewertet, bisheriger Wert bleibt",
      ].filter(Boolean);
      return {
        label,
        weight: weights[place] ?? 0,
        score,
        reason: parts.join(" · "),
        confidence,
      };
    });

    const order = ranking.map((item, place) => `${place + 1}. ${labels[item.index]}`).join(" · ");
    return { params, reason: `Rangfolge: ${order}` };
  });
