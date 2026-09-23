/**
 * Entscheider-Zusammenfassung einer ausgelieferten App: Kernaussage, Ampel und
 * die wichtigsten Treiber. Wird von der Teams-Karte und vom Cockpit genutzt.
 * Nur serverseitig verwenden.
 */
import type { Edge } from "@xyflow/react";
import type { NodeRecord } from "@/components/canvas/board-context";
import { loadAppNodes, type NodeRow } from "@/lib/app-data.server";
import { formatValue, readFormat, valueOfNode } from "@/lib/calc";
import { readFactor } from "@/lib/factor-score";
import { classOf, evaluate, readIsoRisk } from "@/lib/iso-risk";
import { readInspection, totalCost } from "@/lib/inspection";

export type SummaryMetric = {
  id: string;
  label: string;
  value: string;
  hint: string;
};

export type AppSummary = {
  appId: string;
  title: string;
  description: string;
  boardTitle: string;
  kind: string;
  /** Ampel der Gesamtlage: grün, bernstein oder rot. */
  signal: "ok" | "warn" | "alert";
  headline: string;
  metrics: SummaryMetric[];
  openFindings: number;
  urgentFindings: number;
  openCost: number;
  updatedAt: string;
};

function asRecord(row: NodeRow): NodeRecord {
  return row as unknown as NodeRecord;
}

function safe<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

/** Baut die Entscheidungsgrundlage aus den Modulen der App. */
export async function appSummary(appId: string): Promise<AppSummary> {
  const { db, app, nodes, boardTitle } = await loadAppNodes(appId);

  const edgeRes = await db
    .from("edges")
    .select("id,source_id,target_id,label")
    .eq("board_id", app.board_id);
  const edges: Edge[] = (edgeRes.data ?? []).map((row) => ({
    id: String(row.id),
    source: String(row.source_id),
    target: String(row.target_id),
    label: (row.label as string | null) ?? undefined,
  }));
  const records: Record<string, NodeRecord> = Object.fromEntries(
    nodes.map((row) => [row.id, asRecord(row)]),
  );

  const metrics: SummaryMetric[] = [];
  let signal: AppSummary["signal"] = "ok";
  const raise = (next: AppSummary["signal"]) => {
    const rank = { ok: 0, warn: 1, alert: 2 } as const;
    if (rank[next] > rank[signal]) signal = next;
  };

  // Risikomatrix: Klasse bestimmt die Ampel der Gesamtlage.
  for (const row of nodes.filter((item) => item.type === "risk")) {
    const risk = safe(() => readIsoRisk(asRecord(row)), null);
    if (!risk?.fields.length) continue;
    const result = safe(() => evaluate(risk.fields), null);
    if (!result) continue;
    const klass = classOf(result.highest);
    metrics.push({
      id: row.id,
      label: row.title ?? "Risiko",
      value: `${klass.label} · Score ${result.highest}`,
      hint: `${klass.action} · Portfolio-Index ${result.index}`,
    });
    if (klass.key === "D") raise("alert");
    else if (klass.key === "C") raise("warn");
  }

  // Gewichtete Faktoren: 1–10, ab 7 kritisch.
  for (const row of nodes.filter((item) => item.type === "note")) {
    const factor = safe(() => readFactor(asRecord(row)), null);
    if (!factor?.stored || !factor.params.length) continue;
    metrics.push({
      id: row.id,
      label: row.title ?? "Faktor",
      value: `${factor.score.toFixed(1)} / 10`,
      hint: factor.balanced ? "Gewichte vollständig" : "Gewichte ergeben nicht 100 %",
    });
    if (factor.score >= 8) raise("alert");
    else if (factor.score >= 6) raise("warn");
  }

  // Kennzahlen, Tachos und Rechnungen.
  for (const row of nodes.filter((item) =>
    ["metric", "gauge", "sheet", "api", "mcp"].includes(item.type),
  )) {
    const value = safe(() => valueOfNode(asRecord(row), records, edges), null);
    if (value === null || value === undefined) continue;
    metrics.push({
      id: row.id,
      label: row.title ?? "Kennzahl",
      value: safe(() => formatValue(value, readFormat(asRecord(row).metadata)), String(value)),
      hint: "Aktueller Wert aus dem Scope",
    });
  }

  let openFindings = 0;
  let urgentFindings = 0;
  let openCost = 0;
  for (const row of nodes.filter((item) => item.type === "inspect")) {
    const findings = safe(() => readInspection(asRecord(row)).findings, []);
    const open = findings.filter((item) => item.status !== "erledigt");
    openFindings += open.length;
    urgentFindings += open.filter((item) => item.priority <= 3).length;
    openCost += totalCost(open);
  }
  if (urgentFindings > 0) raise("alert");
  else if (openFindings > 0) raise("warn");

  if (openFindings > 0) {
    metrics.unshift({
      id: "findings",
      label: "Offene Befunde",
      value: `${openFindings}`,
      hint: `${urgentFindings} dringend · offene Kosten ${Math.round(openCost).toLocaleString("de-DE")} €`,
    });
  }

  const headline =
    signal === "alert"
      ? "Sofortiger Handlungsbedarf"
      : signal === "warn"
        ? "Beobachten und einplanen"
        : "Lage stabil";

  return {
    appId: app.id,
    title: app.title,
    description: app.description ?? "",
    boardTitle,
    kind: app.kind,
    signal,
    headline,
    metrics: metrics.slice(0, 8),
    openFindings,
    urgentFindings,
    openCost: Math.round(openCost),
    updatedAt: app.updated_at,
  };
}
