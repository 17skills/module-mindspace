import { useSyncExternalStore } from "react";

/** Shared, non-persisted focus between the risk matrix and the map module. */
type Focus = { ids: string[]; label: string };

let current: Focus = { ids: [], label: "" };
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

export function setMapFocus(ids: string[], label: string) {
  current = { ids, label };
  emit();
}

export function clearMapFocus() {
  if (!current.ids.length && !current.label) return;
  current = { ids: [], label: "" };
  emit();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const EMPTY: Focus = { ids: [], label: "" };

export function useMapFocus(): Focus {
  return useSyncExternalStore(
    subscribe,
    () => current,
    () => EMPTY,
  );
}
