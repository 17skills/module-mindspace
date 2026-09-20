export type TemplateField = {
  title: string;
  x: number;
  y: number;
  w: number;
  h: number;
};

export type Template = {
  id: string;
  title: string;
  description: string;
  fields: TemplateField[];
};

/** White background used by all template fields. */
export const ZONE_WHITE = "var(--card)";

const bmc: TemplateField[] = [
  { title: "Schlüsselpartner", x: 0, y: 0, w: 320, h: 520 },
  { title: "Schlüsselaktivitäten", x: 330, y: 0, w: 320, h: 255 },
  { title: "Schlüsselressourcen", x: 330, y: 265, w: 320, h: 255 },
  { title: "Wertangebot", x: 660, y: 0, w: 320, h: 520 },
  { title: "Kundenbeziehungen", x: 990, y: 0, w: 320, h: 255 },
  { title: "Kanäle", x: 990, y: 265, w: 320, h: 255 },
  { title: "Kundensegmente", x: 1320, y: 0, w: 320, h: 520 },
  { title: "Kostenstruktur", x: 0, y: 530, w: 815, h: 240 },
  { title: "Einnahmequellen", x: 825, y: 530, w: 815, h: 240 },
];

const lean: TemplateField[] = [
  { title: "Problem", x: 0, y: 0, w: 320, h: 520 },
  { title: "Lösung", x: 330, y: 0, w: 320, h: 255 },
  { title: "Kennzahlen", x: 330, y: 265, w: 320, h: 255 },
  { title: "Alleinstellung", x: 660, y: 0, w: 320, h: 520 },
  { title: "Unfairer Vorteil", x: 990, y: 0, w: 320, h: 255 },
  { title: "Kanäle", x: 990, y: 265, w: 320, h: 255 },
  { title: "Zielgruppe", x: 1320, y: 0, w: 320, h: 520 },
  { title: "Kosten", x: 0, y: 530, w: 815, h: 240 },
  { title: "Erlöse", x: 825, y: 530, w: 815, h: 240 },
];

const swot: TemplateField[] = [
  { title: "Stärken", x: 0, y: 0, w: 480, h: 360 },
  { title: "Schwächen", x: 490, y: 0, w: 480, h: 360 },
  { title: "Chancen", x: 0, y: 370, w: 480, h: 360 },
  { title: "Risiken", x: 490, y: 370, w: 480, h: 360 },
];

const kanban: TemplateField[] = [
  { title: "Ideen", x: 0, y: 0, w: 300, h: 720 },
  { title: "In Arbeit", x: 310, y: 0, w: 300, h: 720 },
  { title: "Review", x: 620, y: 0, w: 300, h: 720 },
  { title: "Fertig", x: 930, y: 0, w: 300, h: 720 },
];

const retro: TemplateField[] = [
  { title: "Lief gut", x: 0, y: 0, w: 380, h: 600 },
  { title: "Lief nicht gut", x: 390, y: 0, w: 380, h: 600 },
  { title: "Ideen", x: 780, y: 0, w: 380, h: 600 },
  { title: "Nächste Schritte", x: 1170, y: 0, w: 380, h: 600 },
];

const journey: TemplateField[] = [
  { title: "Aufmerksam werden", x: 0, y: 0, w: 320, h: 520 },
  { title: "Informieren", x: 330, y: 0, w: 320, h: 520 },
  { title: "Entscheiden", x: 660, y: 0, w: 320, h: 520 },
  { title: "Kaufen", x: 990, y: 0, w: 320, h: 520 },
  { title: "Bleiben & Empfehlen", x: 1320, y: 0, w: 320, h: 520 },
];

const empathy: TemplateField[] = [
  { title: "Denkt & fühlt", x: 0, y: 0, w: 460, h: 300 },
  { title: "Hört", x: 470, y: 0, w: 460, h: 300 },
  { title: "Sieht", x: 0, y: 310, w: 460, h: 300 },
  { title: "Sagt & tut", x: 470, y: 310, w: 460, h: 300 },
  { title: "Schmerzpunkte", x: 0, y: 620, w: 460, h: 260 },
  { title: "Gewinne", x: 470, y: 620, w: 460, h: 260 },
];

const content: TemplateField[] = [
  { title: "Quellen", x: 0, y: 0, w: 380, h: 640 },
  { title: "Kernaussagen", x: 390, y: 0, w: 380, h: 640 },
  { title: "Outline", x: 780, y: 0, w: 380, h: 640 },
  { title: "Fertige Posts", x: 1170, y: 0, w: 380, h: 640 },
];

export const SYSTEM_TEMPLATES: Template[] = [
  { id: "bmc", title: "Business Model Canvas", description: "Neun Felder für dein Geschäftsmodell", fields: bmc },
  { id: "lean", title: "Lean Canvas", description: "Problem, Lösung und Markt auf einen Blick", fields: lean },
  { id: "swot", title: "SWOT", description: "Stärken, Schwächen, Chancen, Risiken", fields: swot },
  { id: "kanban", title: "Kanban", description: "Vier Spalten für den Arbeitsfluss", fields: kanban },
  { id: "retro", title: "Retrospektive", description: "Rückblick im Team", fields: retro },
  { id: "journey", title: "Customer Journey", description: "Fünf Phasen der Kundenreise", fields: journey },
  { id: "empathy", title: "Empathy Map", description: "Sichtweise deiner Zielgruppe", fields: empathy },
  { id: "content", title: "Content-Pipeline", description: "Von der Quelle zum fertigen Post", fields: content },
];

export function templateBounds(fields: TemplateField[]) {
  const width = Math.max(...fields.map((f) => f.x + f.w), 1);
  const height = Math.max(...fields.map((f) => f.y + f.h), 1);
  return { width, height };
}
