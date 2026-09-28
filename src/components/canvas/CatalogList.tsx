/**
 * Building blocks from the core catalog, grouped. A click places the block
 * with its presets, limits and approval duty on the canvas.
 */
import { useMemo, useState } from "react";
import { ShieldCheck, Clock, KeyRound } from "lucide-react";
import { catalogSummary } from "@/lib/runtime/catalog";

const GROUP_LABEL: Record<string, string> = {
  "data-source": "Datenquellen",
  capture: "Erfassung",
  transform: "Verarbeitung",
  agent: "KI & Agenten",
  decision: "Regeln & Entscheidung",
  visualization: "Darstellung",
  output: "Ergebnis",
  action: "Wirkung nach außen",
  container: "Hintergrundfelder",
};

export function CatalogList({ query, onPick }: { query: string; onPick: (name: string) => void | Promise<void> }) {
  const [busy, setBusy] = useState<string | null>(null);
  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = catalogSummary().filter(
      (m) => !q || `${m.title} ${m.description} ${m.tags.join(" ")}`.toLowerCase().includes(q),
    );
    const map = new Map<string, typeof list>();
    for (const m of list) map.set(m.category, [...(map.get(m.category) ?? []), m]);
    return [...map.entries()];
  }, [query]);

  if (!groups.length) return <p className="text-sm text-muted-foreground">Kein Baustein passt zur Suche.</p>;

  return (
    <div className="space-y-5">
      {groups.map(([category, modules]) => (
        <section key={category}>
          <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {GROUP_LABEL[category] ?? category}
          </h3>
          <div className="grid gap-2 sm:grid-cols-2">
            {modules.map((m) => (
              <button
                key={m.name}
                type="button"
                disabled={busy !== null}
                onClick={async () => {
                  setBusy(m.name);
                  try {
                    await onPick(m.name);
                  } finally {
                    setBusy(null);
                  }
                }}
                className="rounded-xl border bg-card p-3 text-left transition hover:border-ring/60 hover:bg-accent/40 disabled:opacity-60"
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-sm font-medium">{m.title}</span>
                  <span className="font-mono text-[10px] text-muted-foreground">v{m.version}</span>
                </div>
                <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{m.description}</p>
                <p className="mt-2 text-[11px] text-muted-foreground">
                  {m.inputs.length ? `Ein: ${m.inputs.map((p) => p.title || p.port).join(", ")}` : "Ohne Eingang"}
                  {" · "}
                  {m.outputs.length ? `Aus: ${m.outputs.map((p) => p.title || p.port).join(", ")}` : "Ohne Ausgang"}
                </p>
                <div className="mt-2 flex flex-wrap gap-1.5 text-[10px]">
                  {m.derivedFrom ? (
                    <span className="rounded-full border px-2 py-0.5 text-muted-foreground">
                      Ableitung von {m.derivedFrom.replace(/^core\//, "")}
                    </span>
                  ) : (
                    <span className="rounded-full border px-2 py-0.5 text-muted-foreground">Grundbaustein</span>
                  )}
                  {m.requiresApproval ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-destructive/10 px-2 py-0.5 text-destructive">
                      <ShieldCheck className="size-3" /> Freigabe nötig
                    </span>
                  ) : null}
                  {m.executionMode === "scheduled" ? (
                    <span className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-muted-foreground">
                      <Clock className="size-3" /> Zeitplan (startet nur per Knopf)
                    </span>
                  ) : null}
                  {m.secrets.length ? (
                    <span className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-muted-foreground">
                      <KeyRound className="size-3" /> Schlüssel nötig
                    </span>
                  ) : null}
                </div>
              </button>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
