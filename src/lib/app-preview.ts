import type { NodeRecord } from "@/components/canvas/board-context";
import { executiveView, type Executive, type Signal } from "@/lib/app-executive";

export type PreviewScenario = "live" | Signal;

const SCENARIOS: Record<Signal, Executive> = {
  ok: {
    signal: "ok",
    headline: "Lage stabil – Ziele werden erreicht",
    drivers: [
      { id: "preview-availability", label: "Anlagenverfügbarkeit", value: "98,7 %", hint: "Zielwert 97 % · im Plan", signal: "ok" },
      { id: "preview-actions", label: "Offene Maßnahmen", value: "2", hint: "Keine kritischen Maßnahmen", signal: "ok" },
      { id: "preview-budget", label: "Budgetabweichung", value: "+1,8 %", hint: "Innerhalb der Toleranz", signal: "ok" },
    ],
    openFindings: 2,
    urgentFindings: 0,
    openCost: 12400,
  },
  warn: {
    signal: "warn",
    headline: "Beobachten und einplanen",
    drivers: [
      { id: "preview-availability", label: "Anlagenverfügbarkeit", value: "95,4 %", hint: "1,6 Punkte unter Zielwert", signal: "warn" },
      { id: "preview-actions", label: "Offene Maßnahmen", value: "7", hint: "Zwei Maßnahmen diese Woche fällig", signal: "warn" },
      { id: "preview-budget", label: "Budgetabweichung", value: "+3,2 %", hint: "Noch innerhalb der Freigabe", signal: "ok" },
    ],
    openFindings: 7,
    urgentFindings: 0,
    openCost: 48600,
  },
  alert: {
    signal: "alert",
    headline: "Sofortiger Handlungsbedarf",
    drivers: [
      { id: "preview-availability", label: "Anlagenverfügbarkeit", value: "88,1 %", hint: "8,9 Punkte unter Zielwert", signal: "alert" },
      { id: "preview-actions", label: "Kritische Befunde", value: "3", hint: "Priorität 1–3 · Entscheidung heute", signal: "alert" },
      { id: "preview-budget", label: "Budgetabweichung", value: "+8,6 %", hint: "Freigabegrenze überschritten", signal: "warn" },
    ],
    openFindings: 11,
    urgentFindings: 3,
    openCost: 126000,
  },
};

export function previewExecutiveView(nodes: NodeRecord[], scenario: PreviewScenario): Executive {
  return scenario === "live" ? executiveView(nodes) : SCENARIOS[scenario];
}

export type DeploymentField = "title" | "leadQuestion" | "audience" | "metrics";

export function deploymentIssues(input: {
  title: string;
  leadQuestion: string;
  audience: string;
  nodes: NodeRecord[];
}): Record<DeploymentField, string | null> {
  return {
    title: input.title.trim() ? null : "Titel ergänzen",
    leadQuestion: input.leadQuestion.trim() ? null : "Leitfrage ergänzen",
    audience: input.audience.trim() ? null : "Zielgruppe ergänzen",
    metrics: executiveView(input.nodes).drivers.length > 0 ? null : "Mindestens eine aussagekräftige Kennzahl auswählen",
  };
}