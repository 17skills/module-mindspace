/**
 * Aufbau-Varianten der ausgelieferten App. Die Auswahl im Studio bestimmt nur
 * die Anordnung – welche Module es gibt, entscheidet der Scope.
 */
import type { NodeRecord } from "@/components/canvas/board-context";
import type { AppGridItem, AppLayout } from "@/lib/zones";

export const APP_GRID_COLUMNS = 12;
export const APP_GRID_ROW_HEIGHT = 72;

export const APP_LAYOUTS: { id: AppLayout; label: string; hint: string }[] = [
  {
    id: "auto",
    label: "Automatisch",
    hint: "Passt sich den gewählten Modulen an.",
  },
  {
    id: "free",
    label: "Freie Fläche",
    hint: "Module direkt in der Vorschau verschieben und vergrößern.",
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

function overlaps(a: AppGridItem, b: AppGridItem) {
  return !(
    a.col + a.width <= b.col ||
    b.col + b.width <= a.col ||
    a.row + a.height <= b.row ||
    b.row + b.height <= a.row
  );
}

/** Füllt fehlende Positionen kollisionsfrei auf; gespeicherte Positionen bleiben erhalten. */
export function buildFreeLayout(nodes: NodeRecord[], saved: AppGridItem[]): AppGridItem[] {
  const result: AppGridItem[] = [];
  for (const node of nodes) {
    const stored = saved.find((item) => item.id === node.id);
    const width = Math.min(12, Math.max(2, stored?.width ?? (TILE_TYPES.has(node.type) ? 4 : 6)));
    const height = Math.min(10, Math.max(2, stored?.height ?? (WIDE_TYPES.has(node.type) ? 6 : 3)));
    let candidate: AppGridItem = {
      id: node.id,
      col: Math.min(13 - width, Math.max(1, stored?.col ?? 1)),
      row: Math.max(1, stored?.row ?? 1),
      width,
      height,
    };
    if (result.some((item) => overlaps(candidate, item))) {
      let row = 1;
      let placed = false;
      while (!placed) {
        for (let col = 1; col <= APP_GRID_COLUMNS - width + 1; col += 1) {
          const next = { ...candidate, col, row };
          if (!result.some((item) => overlaps(next, item))) {
            candidate = next;
            placed = true;
            break;
          }
        }
        row += 1;
      }
    }
    result.push(candidate);
  }
  return result;
}

/** Wendet eine Verschiebung/Größenänderung nur an, wenn sie gültig und kollisionsfrei ist. */
export function updateFreeLayout(
  layout: AppGridItem[],
  id: string,
  patch: Partial<Pick<AppGridItem, "col" | "row" | "width" | "height">>,
): AppGridItem[] {
  const current = layout.find((item) => item.id === id);
  if (!current) return layout;
  const width = Math.min(APP_GRID_COLUMNS, Math.max(2, patch.width ?? current.width));
  const next: AppGridItem = {
    ...current,
    ...patch,
    width,
    height: Math.min(10, Math.max(2, patch.height ?? current.height)),
    col: Math.min(APP_GRID_COLUMNS - width + 1, Math.max(1, patch.col ?? current.col)),
    row: Math.max(1, patch.row ?? current.row),
  };
  if (layout.some((item) => item.id !== id && overlaps(next, item))) return layout;
  return layout.map((item) => (item.id === id ? next : item));
}
