import { useSyncExternalStore } from "react";

export type SaveStatus = "idle" | "saving" | "saved" | "error";

interface SaveState {
  pending: number;
  lastSavedAt: number | null;
  lastError: string | null;
}

let state: SaveState = { pending: 0, lastSavedAt: null, lastError: null };
const listeners = new Set<() => void>();
let savedTimer: ReturnType<typeof setTimeout> | null = null;

function emit() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Track a persistence promise so the UI can show a save indicator.
 * Fire-and-forget: errors are stored in the state, never thrown.
 */
export function trackSave<T>(promise: PromiseLike<T>): void {
  state = { ...state, pending: state.pending + 1 };
  if (savedTimer) {
    clearTimeout(savedTimer);
    savedTimer = null;
  }
  emit();
  Promise.resolve(promise).then(
    () => {
      state = { ...state, pending: state.pending - 1, lastSavedAt: Date.now() };
      emit();
    },
    (error: unknown) => {
      state = {
        ...state,
        pending: state.pending - 1,
        lastError: error instanceof Error ? error.message : String(error),
      };
      emit();
    },
  );
}

export function clearSaveError(): void {
  state = { ...state, lastError: null };
  emit();
}

export function useSaveStatus(): { status: SaveStatus; lastSavedAt: number | null; lastError: string | null } {
  const snapshot = useSyncExternalStore(subscribe, () => state, () => state);
  const status: SaveStatus =
    snapshot.pending > 0 ? "saving" : snapshot.lastError ? "error" : snapshot.lastSavedAt ? "saved" : "idle";
  return { status, lastSavedAt: snapshot.lastSavedAt, lastError: snapshot.lastError };
}
