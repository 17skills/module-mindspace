import type { NodeRecord } from "@/components/canvas/board-context";
import { readAppBranding, type AppBranding } from "@/lib/zones";

/** Zwei Bühnen-Typen: mobile Erfassung und Lagebild-Cockpit. */
export type AppKind = "capture" | "cockpit";

export type AppRecord = {
  id: string;
  board_id: string;
  title: string;
  kind: AppKind;
  node_ids: string[];
  branding: AppBranding;
  is_public: boolean;
  updated_at: string;
};

export const APP_KINDS: { id: AppKind; label: string; hint: string }[] = [
  {
    id: "capture",
    label: "Mobile Erfassung",
    hint: "Foto vor Ort aufnehmen, Standort und KI-Bewertung – für Techniker am Handy.",
  },
  {
    id: "cockpit",
    label: "Lagebild-Cockpit",
    hint: "Karte, Befundliste und Maßnahmenplan – für Disposition und Leitung.",
  },
];

export const MAX_APP_MODULES = 5;

/** Branding aus der Datenbankspalte lesen, mit denselben Regeln wie im Studio. */
export function brandingFrom(raw: unknown): AppBranding {
  return readAppBranding({ metadata: { appBranding: raw } } as unknown as NodeRecord);
}

/** Vorschlag, welche Bühne zu den gewählten Modulen passt. */
export function suggestKind(types: string[]): AppKind {
  const set = new Set(types);
  if (set.has("map") || set.has("risk") || set.has("decision") || set.has("metric")) {
    return "cockpit";
  }
  return set.has("inspect") ? "capture" : "cockpit";
}

/** Erstes Inspektionsmodul der App – dort landen neue Fotos. */
export function inspectNodeId(nodes: { id: string; type: string }[]): string | null {
  return nodes.find((node) => node.type === "inspect")?.id ?? null;
}
