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

export type FreeLayoutAlignment = "left" | "center-x" | "right" | "top" | "center-y" | "bottom";
export type FreeLayoutGuides = { vertical?: number; horizontal?: number };

function validLayout(layout: AppGridItem[]) {
  return layout.every(
    (item, index) =>
      item.col >= 1 &&
      item.row >= 1 &&
      item.width >= 2 &&
      item.height >= 2 &&
      item.col + item.width <= APP_GRID_COLUMNS + 1 &&
      !layout.some((other, otherIndex) => index !== otherIndex && overlaps(item, other)),
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

/** Richtet mehrere Module an ihrem gemeinsamen äußeren Rahmen aus. */
export function alignFreeLayout(
  layout: AppGridItem[],
  ids: string[],
  alignment: FreeLayoutAlignment,
): AppGridItem[] {
  const selected = layout.filter((item) => ids.includes(item.id));
  if (selected.length < 2) return layout;
  const left = Math.min(...selected.map((item) => item.col));
  const right = Math.max(...selected.map((item) => item.col + item.width));
  const top = Math.min(...selected.map((item) => item.row));
  const bottom = Math.max(...selected.map((item) => item.row + item.height));
  const next = layout.map((item) => {
    if (!ids.includes(item.id)) return item;
    if (alignment === "left") return { ...item, col: left };
    if (alignment === "right") return { ...item, col: right - item.width };
    if (alignment === "center-x") {
      return { ...item, col: Math.round((left + right - item.width) / 2) };
    }
    if (alignment === "top") return { ...item, row: top };
    if (alignment === "bottom") return { ...item, row: bottom - item.height };
    return { ...item, row: Math.round((top + bottom - item.height) / 2) };
  });
  return validLayout(next) ? next : layout;
}

function nearestDelta(own: number[], targets: number[], threshold: number) {
  let best: { delta: number; target: number } | null = null;
  for (const source of own) {
    for (const target of targets) {
      const delta = target - source;
      if (!Number.isInteger(delta) || Math.abs(delta) > threshold) continue;
      if (!best || Math.abs(delta) < Math.abs(best.delta)) best = { delta, target };
    }
  }
  return best;
}

/** Lässt ein bewegtes Modul magnetisch an Kanten und Mittellinien seiner Nachbarn einrasten. */
export function snapFreeLayout(
  layout: AppGridItem[],
  id: string,
  patch: Partial<Pick<AppGridItem, "col" | "row" | "width" | "height">>,
  kind: "move" | "resize",
  enabled: boolean,
): { layout: AppGridItem[]; guides: FreeLayoutGuides } {
  const current = layout.find((item) => item.id === id);
  if (!current) return { layout, guides: {} };
  if (!enabled) return { layout: updateFreeLayout(layout, id, patch), guides: {} };

  const width = Math.min(APP_GRID_COLUMNS, Math.max(2, patch.width ?? current.width));
  const candidate = {
    ...current,
    ...patch,
    width,
    height: Math.min(10, Math.max(2, patch.height ?? current.height)),
    col: Math.min(APP_GRID_COLUMNS - width + 1, Math.max(1, patch.col ?? current.col)),
    row: Math.max(1, patch.row ?? current.row),
  };
  const others = layout.filter((item) => item.id !== id);
  const xTargets = others.flatMap((item) => [item.col, item.col + item.width / 2, item.col + item.width]);
  const yTargets = others.flatMap((item) => [item.row, item.row + item.height / 2, item.row + item.height]);
  const ownX = kind === "resize"
    ? [candidate.col + candidate.width]
    : [candidate.col, candidate.col + candidate.width / 2, candidate.col + candidate.width];
  const ownY = kind === "resize"
    ? [candidate.row + candidate.height]
    : [candidate.row, candidate.row + candidate.height / 2, candidate.row + candidate.height];
  const xSnap = nearestDelta(ownX, xTargets, 1);
  const ySnap = nearestDelta(ownY, yTargets, 1);
  const snappedPatch = kind === "resize"
    ? {
        ...patch,
        width: candidate.width + (xSnap?.delta ?? 0),
        height: candidate.height + (ySnap?.delta ?? 0),
      }
    : {
        ...patch,
        col: candidate.col + (xSnap?.delta ?? 0),
        row: candidate.row + (ySnap?.delta ?? 0),
      };
  const snapped = updateFreeLayout(layout, id, snappedPatch);
  if (snapped === layout) {
    return { layout: updateFreeLayout(layout, id, patch), guides: {} };
  }
  const guides: FreeLayoutGuides = {};
  if (xSnap) guides.vertical = xSnap.target;
  if (ySnap) guides.horizontal = ySnap.target;
  return { layout: snapped, guides };
}
