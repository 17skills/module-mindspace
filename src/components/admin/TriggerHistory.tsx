import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { adminListTriggerEvents } from "@/lib/admin.functions";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const LABEL: Record<string, string> = { fired: "Gestartet", skipped: "Übersprungen", failed: "Fehlgeschlagen" };
const VARIANT: Record<string, "default" | "secondary" | "destructive"> = {
  fired: "default",
  skipped: "secondary",
  failed: "destructive",
};

export function TriggerHistory() {
  const [status, setStatus] = useState("all");
  const events = useQuery({
    queryKey: ["admin-trigger-events", status],
    queryFn: () => adminListTriggerEvents({ data: { status } }),
  });
  const rows = events.data ?? [];
  return (
    <section className="rounded-2xl border bg-card p-6 shadow-[var(--shadow-card)]">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-xl font-semibold text-brand-navy">Ausführungsverlauf</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Automatische Läufe zur Qualitätsprüfung. Nur Zeit, Ergebnis und Grund, keine Nachrichteninhalte.
            Aufbewahrung 90 Tage.
          </p>
        </div>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-44" aria-label="Nach Ergebnis filtern">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Alle</SelectItem>
            <SelectItem value="fired">Gestartet</SelectItem>
            <SelectItem value="skipped">Übersprungen</SelectItem>
            <SelectItem value="failed">Fehlgeschlagen</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {events.error && <p className="mt-4 text-sm text-destructive">{(events.error as Error).message}</p>}
      <ul className="mt-4 divide-y rounded-xl border">
        {rows.length === 0 && !events.isLoading && (
          <li className="px-4 py-3 text-sm text-muted-foreground">Noch keine automatischen Läufe.</li>
        )}
        {rows.map((e) => (
          <li
            key={e.id}
            className="grid gap-1 px-4 py-2.5 text-sm sm:grid-cols-[9rem_1fr_auto] sm:items-center sm:gap-3"
          >
            <Badge variant={VARIANT[e.status] ?? "secondary"} className="w-fit">
              {LABEL[e.status] ?? e.status}
            </Badge>
            <span className="min-w-0">
              <span className="font-medium">{e.scope}</span>
              {e.name ? ` · ${e.name}` : ""}
              <span className="block truncate text-xs text-muted-foreground" title={e.reason}>
                {e.reason || "–"}
              </span>
            </span>
            <span className="text-xs text-muted-foreground">
              {e.source} · {e.runs > 0 ? `${e.runs} Ergebnis(se) · ` : ""}
              {new Date(e.createdAt).toLocaleString("de-DE")}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
