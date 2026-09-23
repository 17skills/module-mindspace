/**
 * Zusammenführen gleichzeitiger Änderungen.
 *
 * Kommt eine fremde Änderung an einem Modul herein, das gerade selbst
 * bearbeitet wurde, wird Feld für Feld zusammengeführt: alles, was man selbst
 * nicht angefasst hat, wird übernommen. Nur wirklich kollidierende Felder
 * bleiben lokal stehen und werden als Konflikt zur Entscheidung angeboten.
 */

import { useSyncExternalStore } from "react";
import type { NodeRecord } from "@/components/canvas/board-context";

/** So lange nach der eigenen Änderung gilt ein Feld als "gerade bearbeitet". */
export const LOCAL_WINDOW_MS = 90_000;

export const MERGE_FIELDS = [
  "title",
  "content",
  "position_x",
  "position_y",
  "width",
  "height",
  "color",
  "status",
  "parent_id",
  "source_url",
  "metadata",
] as const;

export type MergeField = (typeof MERGE_FIELDS)[number];

export type Conflict = {
  id: string;
  nodeId: string;
  nodeTitle: string;
  field: MergeField;
  mine: unknown;
  theirs: unknown;
  at: number;
};

export const FIELD_LABEL: Record<string, string> = {
  title: "Titel",
  content: "Inhalt",
  position_x: "Position (waagerecht)",
  position_y: "Position (senkrecht)",
  width: "Breite",
  height: "Höhe",
  color: "Farbe",
  status: "Status",
  parent_id: "Zugehörigkeit",
  source_url: "Quelle",
  metadata: "Einstellungen",
};

function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null && b == null) return true;
  if (typeof a === "object" || typeof b === "object") {
    try {
      return JSON.stringify(a) === JSON.stringify(b);
    } catch {
      return false;
    }
  }
  return false;
}

/* ---------------------------------------------------------------- */
/* Welche Felder habe ich gerade selbst geändert?                     */
/* ---------------------------------------------------------------- */

const touched = new Map<string, Map<string, number>>();

export function markLocalEdit(nodeId: string, fields: string[], now = Date.now()) {
  const map = touched.get(nodeId) ?? new Map<string, number>();
  for (const field of fields) map.set(field, now);
  touched.set(nodeId, map);
}

export function forgetLocalEdits(nodeId: string) {
  touched.delete(nodeId);
}

export function isLocallyEdited(nodeId: string, field: string, now = Date.now()): boolean {
  const at = touched.get(nodeId)?.get(field);
  return at != null && now - at < LOCAL_WINDOW_MS;
}

/* ---------------------------------------------------------------- */
/* Zusammenführen                                                    */
/* ---------------------------------------------------------------- */

export type MergeResult = { merged: NodeRecord; conflicts: Conflict[] };

/**
 * Fremde Fassung in die eigene einarbeiten.
 * `dirty` sagt, welche Felder gerade lokal bearbeitet wurden.
 */
export function mergeRemoteNode(
  local: NodeRecord | undefined,
  remote: NodeRecord,
  dirty: (field: string) => boolean,
  now = Date.now(),
): MergeResult {
  if (!local) return { merged: remote, conflicts: [] };
  const merged: NodeRecord = { ...remote };
  const conflicts: Conflict[] = [];
  for (const field of MERGE_FIELDS) {
    const mine = (local as Record<string, unknown>)[field];
    const theirs = (remote as Record<string, unknown>)[field];
    if (same(mine, theirs)) continue;
    if (!dirty(field)) continue;
    // eigenes Feld gewinnt vorerst, die fremde Fassung kommt zur Entscheidung
    (merged as Record<string, unknown>)[field] = mine;
    conflicts.push({
      id: `${remote.id}:${field}`,
      nodeId: remote.id,
      nodeTitle: local.title || remote.title || "Unbenanntes Modul",
      field,
      mine,
      theirs,
      at: now,
    });
  }
  return { merged, conflicts };
}

/* ---------------------------------------------------------------- */
/* Offene Konflikte                                                  */
/* ---------------------------------------------------------------- */

let open: Conflict[] = [];
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

export function addConflicts(list: Conflict[]) {
  if (!list.length) return;
  const byId = new Map(open.map((item) => [item.id, item]));
  for (const item of list) byId.set(item.id, item);
  open = [...byId.values()];
  emit();
}

export function resolveConflict(id: string) {
  open = open.filter((item) => item.id !== id);
  emit();
}

export function clearConflicts() {
  open = [];
  emit();
}

export function useConflicts(): Conflict[] {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => open,
    () => open,
  );
}

/** Kurze, lesbare Darstellung eines Feldwertes für die Gegenüberstellung. */
export function describeValue(value: unknown): string {
  if (value == null || value === "") return "leer";
  if (typeof value === "number") return String(Math.round(value));
  if (typeof value === "string") return value.length > 160 ? `${value.slice(0, 160)}…` : value;
  try {
    const text = JSON.stringify(value);
    return text.length > 160 ? `${text.slice(0, 160)}…` : text;
  } catch {
    return String(value);
  }
}
