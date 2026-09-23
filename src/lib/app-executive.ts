/**
 * Entscheider-Cockpit: verdichtet die Module einer App zu Ampel, Kernaussage
 * und den wichtigsten Treibern. Reine Funktion – auch in der Vorschau nutzbar.
 */
import type { NodeRecord } from "@/components/canvas/board-context";
import { formatValue, readFormat, valueOfNode } from "@/lib/calc";
import { readFactor } from "@/lib/factor-score";
import { classOf, evaluate, readIsoRisk } from "@/lib/iso-risk";
import { readInspection, totalCost } from "@/lib/inspection";

export type Signal = "ok" | "warn" | "alert";

export type Driver = {
  id: string;
  label: string;
  value: string;
  hint: string;
  signal: Signal;
};

export type Executive = {
  signal: Signal;
  headline: string;
  drivers: Driver[];
  openFindings: number;
  urgentFindings: number;
  openCost: number;
};

export const SIGNAL_TEXT: Record<Signal, string> = {
  ok: "Lage stabil",
  warn: "Beobachten und einplanen",
  alert: "Sofortiger Handlungsbedarf",
};

const RANK: Record<Signal, number> = { ok: 0, warn: 1, alert: 2 };

function safe<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

/** Verdichtet die gewählten Module zu einer Entscheidungsgrundlage. */
export function executiveView(nodes: NodeRecord[]): Executive {
  const records = Object.fromEntries(nodes.map((node) => [node.id, node]));
  const drivers: Driver[] = [];
  let signal: Signal = "ok";
  const raise = (next: Signal) => {
    if (RANK[next] > RANK[signal]) signal = next;
  };

  for (const node of nodes) {
    if (node.type === "risk") {
      const config = safe(() => readIsoRisk(node), null);
      if (!config?.fields.length) continue;
      const result = safe(() => evaluate(config.fields), null);
      if (!result) continue;
      const klass = classOf(result.highest);
      const own: Signal = klass.key === "D" ? "alert" : klass.key === "C" ? "warn" : "ok";
      raise(own);
      drivers.push({
        id: node.id,
        label: node.title || "Risiko",
        value: klass.label,
        hint: `Score ${result.highest} · Index ${result.index} · ${klass.action}`,
        signal: own,
      });
      continue;
    }
    if (node.type === "note") {
      const factor = safe(() => readFactor(node), null);
      if (!factor?.stored || !factor.params.length) continue;
      const own: Signal = factor.score >= 8 ? "alert" : factor.score >= 6 ? "warn" : "ok";
      raise(own);
      drivers.push({
        id: node.id,
        label: node.title || "Faktor",
        value: `${factor.score.toFixed(1)} / 10`,
        hint: factor.balanced ? "Gewichte vollständig" : "Gewichte ergeben nicht 100 %",
        signal: own,
      });
      continue;
    }
    if (["metric", "gauge", "sheet", "api", "mcp"].includes(node.type)) {
      const value = safe(() => valueOfNode(node, records, []), null);
      if (value === null || value === undefined) continue;
      drivers.push({
        id: node.id,
        label: node.title || "Kennzahl",
        value: safe(() => formatValue(value, readFormat(node.metadata)), String(value)),
        hint: node.content ? String(node.content).slice(0, 90) : "Aktueller Wert",
        signal: "ok",
      });
    }
  }

  let openFindings = 0;
  let urgentFindings = 0;
  let openCost = 0;
  for (const node of nodes.filter((item) => item.type === "inspect")) {
    const findings = safe(() => readInspection(node).findings, []);
    const open = findings.filter((item) => item.status !== "erledigt");
    openFindings += open.length;
    urgentFindings += open.filter((item) => item.priority <= 3).length;
    openCost += totalCost(open);
  }
  if (urgentFindings > 0) raise("alert");
  else if (openFindings > 0) raise("warn");

  if (openFindings > 0) {
    drivers.unshift({
      id: "findings",
      label: "Offene Befunde",
      value: String(openFindings),
      hint: `${urgentFindings} dringend · ${Math.round(openCost).toLocaleString("de-DE")} € offen`,
      signal: urgentFindings > 0 ? "alert" : "warn",
    });
  }

  drivers.sort((a, b) => RANK[b.signal] - RANK[a.signal]);

  return {
    signal,
    headline: SIGNAL_TEXT[signal],
    drivers: drivers.slice(0, 5),
    openFindings,
    urgentFindings,
    openCost: Math.round(openCost),
  };
}
