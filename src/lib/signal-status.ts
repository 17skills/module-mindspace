/**
 * Status of a connection point: green = a value flows, amber = waiting for a
 * value, red = the calculation on the connection is invalid, grey = content
 * link without a number.
 */
import type { Edge } from "@xyflow/react";
import type { NodeRecord } from "@/components/canvas/board-context";
import { edgeValue, nodeValue, valueOfNode } from "@/lib/calc";
import { readFactor } from "@/lib/factor-score";

export type PortStatus = "idle" | "ok" | "warn" | "error";

/** Modules that carry content, not numbers — their links stay neutral. */
export const REFERENCE_TYPES = new Set([
  "youtube",
  "podcast",
  "audio",
  "document",
  "link",
  "chat",
  "frame",
  "image",
  "text",
]);

export function isReference(record: NodeRecord | undefined): boolean {
  if (!record) return true;
  if (REFERENCE_TYPES.has(record.type)) return true;
  if (record.type === "note") {
    const factor = readFactor(record);
    return !(factor.stored && factor.params.length) && nodeValue(record) == null;
  }
  return false;
}

/** Plain-language explanation of a red connection signal. */
export type EdgeProblem = { title: string; cause: string; fix: string };

/**
 * Explains why the calculation on a connection cannot produce a value.
 * Only called when a source value exists but the connection result is null.
 */
export function edgeProblem(label: string | null | undefined, raw: number | null): EdgeProblem {
  const text = (label ?? "").trim();

  if (raw == null) {
    return {
      title: "Kein Wert vom Ausgangsmodul",
      cause: "Das verbundene Modul liefert gerade keine Zahl.",
      fix: "Modul ausführen oder einen Wert hinterlegen, dann fließt er hier weiter.",
    };
  }

  const open = (text.match(/\(/g) ?? []).length;
  const close = (text.match(/\)/g) ?? []).length;
  if (open !== close) {
    return {
      title: "Klammern passen nicht",
      cause: `In „${text}“ sind ${open} öffnende und ${close} schließende Klammern.`,
      fix: "Fehlende Klammer ergänzen, z. B. „(x + 10) * 2“.",
    };
  }

  if (/\/\s*0(?:[.,]0+)?(?!\d)/.test(text)) {
    return {
      title: "Teilen durch null",
      cause: `Die Rechnung „${text}“ teilt durch 0 – das ergibt keinen Wert.`,
      fix: "Teiler auf eine Zahl ungleich 0 ändern.",
    };
  }

  const names = (text.match(/[A-Za-z][A-Za-z0-9]*/g) ?? []).filter(
    (name) => name.toUpperCase() !== "X",
  );
  if (names.length) {
    return {
      title: `Unbekannte Variable „${names[0]}“`,
      cause: "In der Rechnung an einer Verbindung ist nur x erlaubt – der eingehende Wert.",
      fix: `„${names[0]}“ durch x ersetzen, z. B. „x * 0,75“.`,
    };
  }

  if (/[+\-*/%]\s*$/.test(text) || /^\s*[*/%]/.test(text)) {
    return {
      title: "Rechnung ist unvollständig",
      cause: `„${text}“ endet oder beginnt mit einem Rechenzeichen.`,
      fix: "Die fehlende Zahl ergänzen, z. B. „x * 0,75“.",
    };
  }

  return {
    title: "Rechnung nicht lesbar",
    cause: `„${text}“ konnte nicht berechnet werden.`,
    fix: "Erlaubt sind x, Zahlen, + − × ÷ und Klammern – z. B. „25 %“, „1500“ oder „x * 0,75“.",
  };
}

/** Status of the output point of a module. */
export function sourceStatus(
  nodeId: string,
  records: Record<string, NodeRecord>,
  edges: Edge[],
): PortStatus {
  if (!edges.some((edge) => edge.source === nodeId)) return "idle";
  const own = records[nodeId];
  const value = own ? valueOfNode(own, records, edges) : null;
  if (value != null) return "ok";
  return isReference(own) ? "idle" : "warn";
}

/** Status of the input point of a module, across all incoming connections. */
export function targetStatus(
  nodeId: string,
  records: Record<string, NodeRecord>,
  edges: Edge[],
): PortStatus {
  const incoming = edges.filter((edge) => edge.target === nodeId);
  if (!incoming.length) return "idle";
  let status: PortStatus = "idle";
  for (const edge of incoming) {
    const source = records[edge.source];
    const raw = source ? valueOfNode(source, records, edges) : null;
    const label = typeof edge.label === "string" ? edge.label : "";
    const result = edgeValue(label, raw);
    if (raw != null && result == null) return "error";
    if (raw == null) {
      if (!isReference(source)) status = "warn";
    } else if (status === "idle") {
      status = "ok";
    }
  }
  return status;
}
