/**
 * "Ergebnis als Kacheln": Schalter je Modul (`metadata.outputFormat === "tiles"`).
 * Die Kacheln werden deterministisch aus den gespeicherten Ergebnissen als
 * OpenUI Lang gebaut – kein zusätzlicher KI-Aufruf, nur Whitelist-Bausteine.
 */
import { clusterOf, euro, isOverdue, totalCost, type Finding } from "@/lib/inspection";

export const TILE_ACTIONS = ["Maßnahmen freigeben", "Zweitprüfung anfordern"] as const;
export type TileAction = (typeof TILE_ACTIONS)[number];

export function readOutputFormat(meta: Record<string, unknown> | null | undefined): "text" | "tiles" {
  return meta?.["outputFormat"] === "tiles" ? "tiles" : "text";
}

const q = (value: string) => JSON.stringify(value);

function tone(priority: number): string {
  if (priority <= 3) return "destructive";
  if (priority <= 6) return "warning";
  return "success";
}

/** Entscheidungs-Briefing aus Inspektionsbefunden (Priorität 1 = am dringendsten). */
export function inspectionTiles(findings: Finding[]): string {
  const open = findings.filter((f) => f.status !== "erledigt");
  const urgent = open.filter((f) => f.priority <= 3);
  const overdue = open.filter(isOverdue);
  const top = [...open].sort((a, b) => a.priority - b.priority).slice(0, 5);
  const alert = urgent.length
    ? `Callout(${q("Handlungsbedarf erkannt")}, ${q(`${urgent.length} Befunde mit Priorität 1–3 sind offen.`)}, "alert")`
    : `Callout(${q("Kein Sofortbedarf")}, ${q("Keine offenen Befunde mit Priorität 1–3.")}, "check")`;
  const rows = top.map(
    (f) =>
      `[${q(f.label)}, ${q(f.action || f.finding || "–")}, StatusBadge(${q(`Prio ${f.priority} · ${clusterOf(f.priority).label}`)}, ${q(tone(f.priority))})]`,
  );
  return [
    "root = Stack([alert, kpis, table, choice])",
    `alert = ${alert}`,
    "kpis = MetricRow([m1, m2, m3])",
    `m1 = Metric(${q("Sofort offen")}, ${q(String(urgent.length))}, "", ${q(urgent.length ? "destructive" : "success")})`,
    `m2 = Metric(${q("Überfällig")}, ${q(String(overdue.length))}, "", ${q(overdue.length ? "warning" : "success")})`,
    `m3 = Metric(${q("Kosten offen")}, ${q(euro(totalCost(open)))}, "", "neutral")`,
    `table = DataTable([${q("Objekt")}, ${q("Maßnahme")}, ${q("Priorität")}], [${rows.join(", ")}])`,
    `choice = ActionChoice([${TILE_ACTIONS.map(q).join(", ")}])`,
  ].join("\n");
}
