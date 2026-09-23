/**
 * Rückgängig und Wiederholen für den Scope-Canvas.
 *
 * Jede rückgängig machbare Handlung wird als kleiner Schritt festgehalten:
 * Verschieben, Einfügen, Löschen, Verbinden und Trennen. Die Schritte sind
 * bewusst reine Daten – das Anwenden übernimmt der Canvas selbst.
 */

import type { NodeRecord } from "@/components/canvas/board-context";

export type Point = { x: number; y: number };

/** Verbindung in der Form, wie sie zum Wiederherstellen gebraucht wird. */
export type EdgeSnapshot = {
  id: string;
  source: string;
  target: string;
  label: string | null;
};

export type HistoryEntry =
  | { kind: "move"; items: { id: string; from: Point; to: Point }[] }
  /** Module wurden angelegt (mit den Verbindungen, die dabei entstanden). */
  | { kind: "nodes.add"; rows: NodeRecord[]; edges: EdgeSnapshot[] }
  /** Module wurden gelöscht (mit allen daran hängenden Verbindungen). */
  | { kind: "nodes.remove"; rows: NodeRecord[]; edges: EdgeSnapshot[] }
  | { kind: "edges.add"; edges: EdgeSnapshot[] }
  | { kind: "edges.remove"; edges: EdgeSnapshot[] };

/** So viele Schritte bleiben erhalten. */
export const HISTORY_LIMIT = 40;

export function pushHistory(stack: HistoryEntry[], entry: HistoryEntry): HistoryEntry[] {
  return [...stack, entry].slice(-HISTORY_LIMIT);
}

/** Gegenteil eines Schritts – daraus entsteht Rückgängig und Wiederholen. */
export function invert(entry: HistoryEntry): HistoryEntry {
  switch (entry.kind) {
    case "move":
      return {
        kind: "move",
        items: entry.items.map((item) => ({ id: item.id, from: item.to, to: item.from })),
      };
    case "nodes.add":
      return { kind: "nodes.remove", rows: entry.rows, edges: entry.edges };
    case "nodes.remove":
      return { kind: "nodes.add", rows: entry.rows, edges: entry.edges };
    case "edges.add":
      return { kind: "edges.remove", edges: entry.edges };
    case "edges.remove":
      return { kind: "edges.add", edges: entry.edges };
  }
}

/** Kurzer Text für Rückmeldungen im Canvas. */
export function describe(entry: HistoryEntry): string {
  switch (entry.kind) {
    case "move":
      return entry.items.length > 1 ? "Verschieben" : "Verschieben";
    case "nodes.add":
      return entry.rows.length > 1 ? "Module einfügen" : "Modul einfügen";
    case "nodes.remove":
      return entry.rows.length > 1 ? "Module löschen" : "Modul löschen";
    case "edges.add":
      return "Verbinden";
    case "edges.remove":
      return "Verbindung trennen";
  }
}

/** Nur echte Ortswechsel festhalten – Klicks ohne Bewegung zählen nicht. */
export function movedItems(
  items: { id: string; from: Point; to: Point }[],
): { id: string; from: Point; to: Point }[] {
  return items.filter(
    (item) => Math.abs(item.from.x - item.to.x) > 0.5 || Math.abs(item.from.y - item.to.y) > 0.5,
  );
}
