/**
 * Offline-Unterstützung für Scopes.
 *
 * Jede Änderung geht zuerst in eine lokale Warteschlange. Ist eine Verbindung
 * da, wird sie sofort abgeschickt; fehlt sie, bleibt sie im Browser liegen und
 * geht automatisch raus, sobald das Netz wieder da ist. Zusätzlich liegt eine
 * Kopie des zuletzt geladenen Scopes im Browser, damit man ihn auch ohne Netz
 * öffnen und ansehen kann.
 */

import { useSyncExternalStore } from "react";
import type { Edge } from "@xyflow/react";
import { supabase } from "@/integrations/supabase/client";
import { trackSave } from "@/lib/save-status";
import type { NodeRecord } from "@/components/canvas/board-context";

const OUTBOX_KEY = "scopebuilder.outbox";
const CACHE_PREFIX = "scopebuilder.board.";

export type Op =
  | { kind: "node.insert"; row: Record<string, unknown> }
  | { kind: "node.update"; id: string; patch: Record<string, unknown> }
  | { kind: "node.delete"; ids: string[] }
  | { kind: "edge.insert"; row: Record<string, unknown> }
  | { kind: "edge.update"; id: string; label: string | null }
  | { kind: "edge.delete"; ids: string[] };

export type QueuedOp = Op & { opId: string; at: number; boardId: string };

/* ---------------------------------------------------------------- */
/* Warteschlange                                                     */
/* ---------------------------------------------------------------- */

let queue: QueuedOp[] = [];
let loaded = false;
let flushing = false;
let online = true;
const listeners = new Set<() => void>();
let snapshot = { pending: 0, online: true };
const UPDATE_DELAY = 180;
type PendingUpdate = {
  op: QueuedOp & { kind: "node.update" };
  timer: ReturnType<typeof setTimeout>;
};
const pendingUpdates = new Map<string, PendingUpdate>();

function emit() {
  snapshot = { pending: queue.length, online };
  for (const listener of listeners) listener();
}

function persist() {
  try {
    window.localStorage.setItem(OUTBOX_KEY, JSON.stringify(queue));
  } catch {
    /* Speicher voll – die Änderung bleibt wenigstens im Bild */
  }
}

function load() {
  if (loaded || typeof window === "undefined") return;
  loaded = true;
  online = navigator.onLine;
  try {
    const raw = window.localStorage.getItem(OUTBOX_KEY);
    const list = raw ? (JSON.parse(raw) as unknown) : [];
    if (Array.isArray(list)) queue = list as QueuedOp[];
  } catch {
    queue = [];
  }
  emit();
}

/** Mehrere Änderungen am selben Modul zusammenfassen, damit nichts doppelt geht. */
export function coalesce(list: QueuedOp[], next: QueuedOp): QueuedOp[] {
  if (next.kind === "node.update") {
    const index = list.findIndex(
      (item) => item.kind === "node.update" && item.id === next.id,
    );
    if (index >= 0) {
      const existing = list[index] as QueuedOp & { kind: "node.update" };
      const merged: QueuedOp = {
        ...existing,
        at: next.at,
        patch: { ...existing.patch, ...next.patch },
      };
      const copy = [...list];
      copy[index] = merged;
      return copy;
    }
  }
  if (next.kind === "edge.update") {
    const index = list.findIndex(
      (item) => item.kind === "edge.update" && item.id === next.id,
    );
    if (index >= 0) {
      const copy = [...list];
      copy[index] = { ...list[index]!, ...next } as QueuedOp;
      return copy;
    }
  }
  return [...list, next];
}

function enqueue(op: QueuedOp) {
  queue = coalesce(queue, op);
  persist();
  emit();
}

function isOffline(error: unknown): boolean {
  if (!navigator.onLine) return true;
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /failed to fetch|networkerror|load failed|fetch failed|timeout/i.test(message);
}

async function runOp(op: QueuedOp): Promise<void> {
  const fail = (error: { message: string } | null) => {
    if (error) throw new Error(error.message);
  };
  switch (op.kind) {
    case "node.insert":
      fail((await supabase.from("nodes").insert(op.row as never)).error);
      return;
    case "node.update":
      fail((await supabase.from("nodes").update(op.patch as never).eq("id", op.id)).error);
      return;
    case "node.delete":
      fail((await supabase.from("nodes").delete().in("id", op.ids)).error);
      return;
    case "edge.insert":
      fail((await supabase.from("edges").insert(op.row as never)).error);
      return;
    case "edge.update":
      fail((await supabase.from("edges").update({ label: op.label }).eq("id", op.id)).error);
      return;
    case "edge.delete":
      fail((await supabase.from("edges").delete().in("id", op.ids)).error);
      return;
  }
}

/** Alles Liegengebliebene der Reihe nach abschicken. */
export async function flushOutbox(): Promise<number> {
  load();
  if (flushing || !queue.length || !navigator.onLine) return 0;
  flushing = true;
  let done = 0;
  try {
    while (queue.length) {
      const op = queue[0]!;
      try {
        await runOp(op);
      } catch (error) {
        if (isOffline(error)) break;
        // Fachlicher Fehler (z. B. gelöschtes Modul): verwerfen, sonst blockiert alles.
        console.warn("Änderung verworfen", op.kind, error);
      }
      queue = queue.slice(1);
      done += 1;
      persist();
      emit();
    }
  } finally {
    flushing = false;
    emit();
  }
  return done;
}

/**
 * Eine Änderung speichern: sofort, wenn möglich – sonst in die Warteschlange.
 */
export function saveOp(boardId: string, op: Op): void {
  load();
  const queued: QueuedOp = { ...op, opId: crypto.randomUUID(), at: Date.now(), boardId };
  if (!navigator.onLine || queue.length) {
    enqueue(queued);
    void flushOutbox();
    return;
  }
  // Text-, Größen- und Metadatenänderungen desselben Moduls kommen oft direkt
  // hintereinander. Kurz sammeln, damit daraus nur ein Schreibvorgang wird.
  if (queued.kind === "node.update") {
    const key = `${boardId}:${queued.id}`;
    const previous = pendingUpdates.get(key);
    if (previous) clearTimeout(previous.timer);
    const merged: QueuedOp & { kind: "node.update" } = previous
      ? {
          ...previous.op,
          at: queued.at,
          patch: { ...previous.op.patch, ...queued.patch },
        }
      : queued;
    const timer = setTimeout(() => {
      pendingUpdates.delete(key);
      trackSave(
        runOp(merged).catch((error: unknown) => {
          if (isOffline(error)) {
            enqueue(merged);
            return;
          }
          throw error;
        }),
      );
    }, UPDATE_DELAY);
    pendingUpdates.set(key, { op: merged, timer });
    return;
  }
  trackSave(
    runOp(queued).catch((error: unknown) => {
      if (isOffline(error)) {
        enqueue(queued);
        return;
      }
      throw error;
    }),
  );
}

export function startOfflineSync(onFlushed?: (count: number) => void): () => void {
  load();
  const up = () => {
    online = true;
    emit();
    void flushOutbox().then((count) => {
      if (count > 0) onFlushed?.(count);
    });
  };
  const down = () => {
    online = false;
    emit();
  };
  window.addEventListener("online", up);
  window.addEventListener("offline", down);
  if (navigator.onLine) up();
  return () => {
    window.removeEventListener("online", up);
    window.removeEventListener("offline", down);
  };
}

export function useOfflineState(): { pending: number; online: boolean } {
  return useSyncExternalStore(
    (listener) => {
      load();
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => snapshot,
    () => ({ pending: 0, online: true }),
  );
}

/* ---------------------------------------------------------------- */
/* Lokale Kopie des Scopes                                           */
/* ---------------------------------------------------------------- */

export type BoardCache = {
  title: string;
  nodes: NodeRecord[];
  edges: Edge[];
  at: number;
};

export function cacheBoard(boardId: string, data: Omit<BoardCache, "at">) {
  try {
    window.localStorage.setItem(
      `${CACHE_PREFIX}${boardId}`,
      JSON.stringify({ ...data, at: Date.now() }),
    );
  } catch {
    /* zu groß für den Browserspeicher – dann eben ohne Offline-Kopie */
  }
}

export function readBoardCache(boardId: string): BoardCache | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(`${CACHE_PREFIX}${boardId}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as BoardCache;
    return Array.isArray(parsed.nodes) ? parsed : null;
  } catch {
    return null;
  }
}
