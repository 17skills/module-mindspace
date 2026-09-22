import { useMemo } from "react";
import { Crosshair } from "lucide-react";
import { useBoard, type NodeRecord } from "@/components/canvas/board-context";
import { evaluate, readIsoRisk } from "@/lib/iso-risk";
import { readMapConfig } from "@/lib/geo";

type Step = {
  title: string;
  hint: string;
  status: string;
  done: boolean;
  target?: NodeRecord | undefined;
  action?: { label: string; run: () => void } | undefined;
};

/** Step-by-step guide through the board: data, calculation, decision, measures. */
export function GuideTab() {
  const { allNodes, focusNode, runDecide } = useBoard();
  const nodes = allNodes();

  const steps = useMemo<Step[]>(() => {
    const tables = nodes.filter((item) => item.type === "table" || item.type === "list");
    const map = nodes.find((item) => item.type === "map");
    const risk = nodes.find((item) => item.type === "risk");
    const decision = nodes.find((item) => item.type === "decision");
    const signals = nodes.filter((item) => item.type === "signal");

    const rows = tables.reduce((sum, item) => {
      const data = (item.metadata as { rows?: unknown[] } | null)?.rows;
      return sum + (Array.isArray(data) ? data.length : 0);
    }, 0);
    const weatherCount = map ? Object.keys(readMapConfig(map).weather).length : 0;
    const riskResult = risk ? evaluate(readIsoRisk(risk).fields) : null;
    const answers = decision
      ? ((decision.metadata as { answers?: Record<string, unknown> } | null)?.answers ?? {})
      : {};
    const answered = Object.keys(answers).length;

    return [
      {
        title: "1 · Datenbasis & Wetter",
        hint: "Anlagen aus der Tabelle auf der Karte verorten und das Wetter abrufen.",
        status: `${rows} Zeilen · ${weatherCount} Wettermeldungen`,
        done: rows > 0 && weatherCount > 0,
        target: map ?? tables[0],
      },
      {
        title: "2 · Risikokalkulation",
        hint: "Messwerte gegen die Grenzwerte prüfen, Eintritt und Auswirkung je Zeile festlegen.",
        status: riskResult
          ? `Klasse ${riskResult.portfolio.key} · Index ${riskResult.index}/100`
          : "Keine Risikomatrix in diesem Scope",
        done: Boolean(riskResult),
        target: risk,
      },
      {
        title: "3 · Lageentscheidung",
        hint: "Die Regeln der Entscheidung gegen den aktuellen Stand prüfen lassen.",
        status: decision ? `${answered} Fragen beantwortet` : "Keine Entscheidung in diesem Scope",
        done: answered > 0,
        target: decision,
        action: decision
          ? { label: "Entscheiden", run: () => runDecide(decision.id) }
          : undefined,
      },
      {
        title: "4 · Maßnahmen & Signale",
        hint: "Die Ampeln zeigen, welche Maßnahme aus der Entscheidung folgt.",
        status: `${signals.length} Signale verbunden`,
        done: signals.length > 0 && answered > 0,
        target: signals[0],
      },
    ];
  }, [nodes, runDecide]);

  return (
    <div className="h-full space-y-2 overflow-auto p-3">
      <p className="text-xs leading-relaxed text-muted-foreground">
        Der Ablauf von der Datenbasis bis zur Maßnahme. Jeder Schritt zeigt seinen aktuellen Stand –
        über den Knopf springst du zur passenden Karte.
      </p>
      {steps.map((step) => (
        <section
          key={step.title}
          className={`rounded-md border p-2.5 ${step.done ? "bg-secondary/30" : "bg-background"}`}
        >
          <div className="flex items-center gap-2">
            <span
              className="size-2 shrink-0 rounded-full"
              style={{ background: step.done ? "var(--note)" : "var(--muted-foreground)" }}
            />
            <p className="min-w-0 flex-1 truncate text-xs font-medium">{step.title}</p>
            {step.target && (
              <button
                onClick={() => focusNode(step.target!.id)}
                aria-label="Karte zeigen"
                title="Karte auf der Fläche zeigen"
                className="rounded-md p-1 text-muted-foreground hover:bg-secondary"
              >
                <Crosshair className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{step.hint}</p>
          <div className="mt-1.5 flex items-center justify-between gap-2">
            <span className="font-mono text-[10px] text-muted-foreground">{step.status}</span>
            {step.action && (
              <button
                onClick={step.action.run}
                className="rounded-md border bg-background px-2 py-1 text-[11px] font-medium hover:bg-secondary"
              >
                {step.action.label}
              </button>
            )}
          </div>
        </section>
      ))}
    </div>
  );
}
