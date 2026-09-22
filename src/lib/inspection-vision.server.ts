import { z } from "zod";
import { runStructured, type AiKeyConfig } from "@/lib/ai-keys.server";

export const Assessment = z.object({
  label: z.string(),
  category: z.string(),
  finding: z.string(),
  priority: z.number(),
  action: z.string(),
  cost: z.number(),
  confidence: z.number(),
  reason: z.string(),
});

export type InspectionAssessment = z.infer<typeof Assessment>;

const RESULT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    label: { type: "string" },
    category: { type: "string" },
    finding: { type: "string" },
    priority: { type: "number" },
    action: { type: "string" },
    cost: { type: "number" },
    confidence: { type: "number" },
    reason: { type: "string" },
  },
  required: ["label", "category", "finding", "priority", "action", "cost", "confidence", "reason"],
} as const;

/** Bewertet ein Inspektionsfoto mit Prüfbericht und liefert Priorität 1–10. */
export async function assessPhoto(
  input: {
    image: string;
    label: string;
    report: string;
    rates: string;
  },
  aiConfig: AiKeyConfig,
): Promise<InspectionAssessment> {
  const prompt = `Du bist Sachverständiger für die Zustandsbewertung von Betriebsmitteln im Stromverteilnetz (Trafostationen, Schaltanlagen, Umzäunungen) nach ISO 55001.

Bewerte das Foto zusammen mit dem Prüfbericht.

Objekt laut Dateiname: ${input.label || "unbekannt"}
Prüfbericht:
${input.report.slice(0, 20_000) || "(kein Bericht mitgeschickt)"}

Hinterlegte Standard-Kostensätze (EUR):
${input.rates || "(keine)"}

Regeln für die Priorität (Skala 1 bis 10):
- 1 bis 3 = Sofortmaßnahme: Personen- oder Betriebsgefahr, offene Anlage, Dachschaden mit Wassereintritt, Baum/Ast direkt über der Station, Zaun vollständig offen.
- 4 bis 6 = Mittelfristig: Instandsetzung nötig, aber kein akutes Risiko (defekter Zaunabschnitt, Korrosion, defekte Tür).
- 7 bis 10 = Beobachtung oder kosmetisch: Graffiti ohne Beschädigung, leichte Verschmutzung, Bewuchs in Abstand.
- "cost" ist eine realistische Schätzung in Euro; nutze die Kostensätze, wenn sie zur Schadensklasse passen.
- "category" ist eine kurze Schadensklasse, z. B. Zaun, Dach, Bewuchs, Graffiti, Tür, Korrosion, Sonstiges.
- "label" ist die Stations- oder Objektbezeichnung, wenn sie auf dem Bild oder im Bericht erkennbar ist, sonst der Dateiname.
- "confidence" ist deine Sicherheit in Prozent (0 bis 100).
- "reason" erklärt in einem Satz, warum diese Priorität gilt.
Antworte auf Deutsch.`;

  const text = await runStructured(aiConfig, {
    fn: "vision",
    prompt,
    image: input.image,
    schemaName: "inspection_assessment",
    schema: RESULT_SCHEMA,
  });

  try {
    return Assessment.parse(JSON.parse(text));
  } catch {
    throw new Error("Die Bildbewertung kam nicht in verwertbarer Form zurück");
  }
}
