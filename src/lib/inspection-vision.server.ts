import { z } from "zod";

const GATEWAY = "https://ai.gateway.lovable.dev/v1";

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

/** Bewertet ein Inspektionsfoto mit Prüfbericht und liefert Priorität 1–10. */
export async function assessPhoto(input: {
  image: string;
  label: string;
  report: string;
  rates: string;
}): Promise<InspectionAssessment> {
  const key = process.env["LOVABLE_API_KEY"];
  if (!key) throw new Error("LOVABLE_API_KEY fehlt");

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

  const response = await fetch(`${GATEWAY}/responses`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "Lovable-API-Key": key,
      "X-Lovable-AIG-SDK": "fetch",
    },
    body: JSON.stringify({
      model: "openai/gpt-6-astra",
      input: [
        {
          role: "user",
          content: [
            { type: "input_text", text: prompt },
            { type: "input_image", image_url: input.image },
          ],
        },
      ],
      store: false,
      reasoning: { effort: "low" },
      text: {
        format: {
          type: "json_schema",
          name: "inspection_assessment",
          strict: true,
          schema: {
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
            required: [
              "label",
              "category",
              "finding",
              "priority",
              "action",
              "cost",
              "confidence",
              "reason",
            ],
          },
        },
      },
    }),
  });

  if (response.status === 402) {
    throw new Error("Das KI-Guthaben ist aufgebraucht – bitte im Arbeitsbereich aufladen.");
  }
  if (response.status === 429) {
    throw new Error("Zu viele Anfragen gleichzeitig – bitte kurz warten und erneut hochladen.");
  }
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Bildbewertung fehlgeschlagen [${response.status}]: ${detail.slice(0, 300)}`);
  }

  const payload = (await response.json()) as {
    output_text?: string;
    output?: { content?: { text?: string }[] }[];
  };
  const text =
    payload.output_text ??
    payload.output?.flatMap((item) => item.content ?? []).find((part) => part.text)?.text ??
    "";

  try {
    return Assessment.parse(JSON.parse(text));
  } catch {
    throw new Error("Die Bildbewertung kam nicht in verwertbarer Form zurück");
  }
}
