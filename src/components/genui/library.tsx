/**
 * Generative Ergebnis-Bausteine: die einzige Komponenten-Whitelist, die ein Modell
 * über OpenUI Lang ansprechen darf. Nur Darstellung; Aktionen melden nur ein Signal.
 */
import { createLibrary, defineComponent, useTriggerAction } from "@openuidev/react-lang";
import { z } from "zod";
import { AlertTriangle, CheckCircle2, Info, TrendingDown, TrendingUp } from "lucide-react";
import { Button } from "@/components/ui/button";

const TONE = z.enum(["neutral", "success", "warning", "destructive"]);
type Tone = z.infer<typeof TONE>;

const toneClass: Record<Tone, string> = {
  neutral: "border-border bg-muted text-foreground",
  success: "border-primary/40 bg-primary/10 text-primary",
  warning: "border-accent bg-accent text-accent-foreground",
  destructive: "border-destructive/40 bg-destructive/10 text-destructive",
};

const text = (v: unknown) => (typeof v === "string" || typeof v === "number" ? String(v) : "");

export const StatusBadge = defineComponent({
  name: "StatusBadge",
  description: "Kompaktes Statusabzeichen",
  props: z.object({ text: z.string(), tone: TONE.optional() }),
  component: ({ props }) => (
    <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-medium ${toneClass[props.tone ?? "neutral"]}`}>
      {props.text}
    </span>
  ),
});

export const Metric = defineComponent({
  name: "Metric",
  description: "Kennzahl mit Beschriftung, optionalem Trend (z. B. +12%) und Ampelton",
  props: z.object({ label: z.string(), value: z.string(), trend: z.string().optional(), tone: TONE.optional() }),
  component: ({ props }) => {
    const down = props.trend?.trim().startsWith("-");
    return (
      <div className={`rounded-lg border p-3 ${toneClass[props.tone ?? "neutral"]}`}>
        <div className="text-xs opacity-80">{props.label}</div>
        <div className="mt-1 text-2xl font-semibold tabular-nums">{props.value}</div>
        {props.trend && (
          <div className="mt-1 flex items-center gap-1 text-xs">
            {down ? <TrendingDown className="h-3 w-3" /> : <TrendingUp className="h-3 w-3" />}
            {props.trend}
          </div>
        )}
      </div>
    );
  },
});

export const Callout = defineComponent({
  name: "Callout",
  description: "Hinweisbox; kind info, alert oder check",
  props: z.object({ title: z.string(), body: z.string().optional(), kind: z.enum(["info", "alert", "check"]).optional() }),
  component: ({ props }) => {
    const kind = props.kind ?? "info";
    const Icon = kind === "alert" ? AlertTriangle : kind === "check" ? CheckCircle2 : Info;
    const tone: Tone = kind === "alert" ? "destructive" : kind === "check" ? "success" : "neutral";
    return (
      <div className={`flex gap-3 rounded-lg border p-3 ${toneClass[tone]}`}>
        <Icon className="mt-0.5 h-4 w-4 shrink-0" />
        <div>
          <div className="text-sm font-semibold">{props.title}</div>
          {props.body && <p className="mt-1 text-sm text-foreground/80">{props.body}</p>}
        </div>
      </div>
    );
  },
});

export const DataTable = defineComponent({
  name: "DataTable",
  description: "Kleine Tabelle, nur lesend. rows ist eine Liste von Zeilen; Zellen sind Text oder StatusBadge",
  props: z.object({ headers: z.array(z.string()), rows: z.array(z.array(z.any())) }),
  component: ({ props, renderNode }) => (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-sm">
        <thead className="bg-muted text-left text-xs text-muted-foreground">
          <tr>{props.headers.map((h) => <th key={h} className="px-3 py-2 font-medium">{h}</th>)}</tr>
        </thead>
        <tbody>
          {props.rows.slice(0, 50).map((row, i) => (
            <tr key={i} className="border-t border-border">
              {(Array.isArray(row) ? row : []).map((cell, j) => (
                <td key={j} className="px-3 py-2">
                  {typeof cell === "object" && cell !== null ? renderNode(cell) : text(cell)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  ),
});

export const ActionChoice = defineComponent({
  name: "ActionChoice",
  description: "Auswahlknöpfe; ein Klick meldet nur die gewählte Option als Signal, keine weitere Wirkung",
  props: z.object({ options: z.array(z.string()) }),
  component: ({ props }) => {
    const trigger = useTriggerAction();
    return (
      <div className="flex flex-wrap gap-2">
        {props.options.slice(0, 4).map((o, i) => (
          <Button key={o} size="sm" variant={i === 0 ? "default" : "outline"}
            onClick={() => trigger(o, undefined, { type: "scope.signal", params: { choice: o } })}>
            {o}
          </Button>
        ))}
      </div>
    );
  },
});

export const Stack = defineComponent({
  name: "Stack",
  description: "Ordnet Elemente untereinander an (Wurzel)",
  props: z.object({ children: z.array(z.any()) }),
  component: ({ props, renderNode }) => (
    <div className="flex flex-col gap-3">{props.children.map((c, i) => <div key={i}>{renderNode(c)}</div>)}</div>
  ),
});

export const MetricRow = defineComponent({
  name: "MetricRow",
  description: "Ordnet Metric-Elemente nebeneinander an",
  props: z.object({ children: z.array(z.any()) }),
  component: ({ props, renderNode }) => (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">{props.children.map((c, i) => <div key={i}>{renderNode(c)}</div>)}</div>
  ),
});

export const genuiLibrary = createLibrary({
  components: [Stack, MetricRow, Metric, StatusBadge, DataTable, Callout, ActionChoice],
  root: "Stack",
});

export const GENUI_SAMPLE = `root = Stack([alert, kpis, table, choice])
alert = Callout("Handlungsbedarf erkannt", "2 von 5 Anlagen zeigen kritische Schwingungswerte.", "alert")
kpis = MetricRow([m1, m2, m3])
m1 = Metric("Gesamtrisiko", "Stufe C", "", "warning")
m2 = Metric("Kostenwirkung", "14.200 €", "+12%", "neutral")
m3 = Metric("Erledigt", "3 / 5", "-1", "success")
table = DataTable(["Anlage", "Standort", "Priorität"], [["Pumpe 04", "Nord", StatusBadge("Kritisch", "destructive")], ["Lüfter 12", "Süd", StatusBadge("Beobachten", "warning")]])
choice = ActionChoice(["Freigabe erteilen", "Zweitprüfung anfordern"])
`;
