/**
 * Aufbau-Varianten der ausgelieferten App. Die Auswahl im Studio bestimmt nur
 * die Anordnung – welche Module es gibt, entscheidet der Scope.
 */
import type { AppLayout } from "@/lib/zones";

export const APP_LAYOUTS: { id: AppLayout; label: string; hint: string }[] = [
  {
    id: "auto",
    label: "Automatisch",
    hint: "Passt sich den gewählten Modulen an.",
  },
  {
    id: "split",
    label: "Geteilte Ansicht",
    hint: "Karte oder Hauptmodul links, Arbeitsliste rechts.",
  },
  {
    id: "dashboard",
    label: "Kennzahlen-Raster",
    hint: "Zahlen oben, weitere Module in zwei Spalten.",
  },
  {
    id: "feed",
    label: "Mobiler Verlauf",
    hint: "Eine Spalte, große Flächen – fürs Smartphone.",
  },
  {
    id: "report",
    label: "Bericht",
    hint: "Alles untereinander in voller Breite.",
  },
  {
    id: "capture",
    label: "Foto-Erfassung",
    hint: "Kamera, Standort und Bewertung vor Ort.",
  },
];

/** Welcher Aufbau passt, wenn „Automatisch“ gewählt ist. */
export function resolveLayout(layout: AppLayout, types: string[]): Exclude<AppLayout, "auto"> {
  if (layout !== "auto") return layout;
  const set = new Set(types);
  if (set.has("map")) return "split";
  if (set.has("inspect") && set.size === 1) return "capture";
  if (set.has("metric") || set.has("gauge") || set.has("sheet") || set.has("calc")) {
    return "dashboard";
  }
  return "report";
}

/** Module, die in der geteilten Ansicht die große linke Fläche bekommen. */
export const WIDE_TYPES = new Set(["map", "risk", "inspect", "table", "chart"]);

/** Module, die als kompakte Kennzahl-Kachel dargestellt werden. */
export const TILE_TYPES = new Set(["metric", "gauge", "calc", "sheet", "api"]);
