import { useSyncExternalStore } from "react";

/**
 * Tiny global switch for connection labels on the canvas.
 * Persisted per browser so the choice survives reloads.
 */
const KEY = "canvas.edgeLabels";
let visible = true;
const listeners = new Set<() => void>();

if (typeof window !== "undefined") {
  visible = window.localStorage.getItem(KEY) !== "off";
}

function emit() {
  for (const listener of listeners) listener();
}

export function setEdgeLabelsVisible(next: boolean) {
  visible = next;
  if (typeof window !== "undefined") {
    window.localStorage.setItem(KEY, next ? "on" : "off");
  }
  emit();
}

export function useEdgeLabelsVisible(): boolean {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => visible,
    () => true,
  );
}
