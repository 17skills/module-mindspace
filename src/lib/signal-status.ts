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
      if (!isReference(source) && status !== "error") status = "warn";
    } else if (status === "idle") {
      status = "ok";
    }
  }
  return status;
}
