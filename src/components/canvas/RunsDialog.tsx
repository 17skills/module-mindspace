import { useCallback, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { OutputView } from "@/components/OutputView";
import { getRunEvents, listRuns, setRetention } from "@/lib/runs.functions";
import { RETENTION_CHOICES, RUN_STATUS_LABEL, type RunStatus } from "@/lib/runs";
import { readOutput } from "@/lib/output";

type RunRow = Awaited<ReturnType<typeof listRuns>>["runs"][number];
type EventRow = Awaited<ReturnType<typeof getRunEvents>>["events"][number];

const ACTION_LABEL: Record<string, string> = {
  created: "angelegt",
  done: "fertig",
  failed: "fehlgeschlagen",
  viewed: "angesehen durch Verwalter",
  purged: "nach Frist gelöscht",
};

function when(value: string | null) {
  return value ? new Date(value).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" }) : "–";
}

export function RunsDialog({
  open,
  onOpenChange,
  outputNodeId,
  retention,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  outputNodeId: string;
  retention: number;
}) {
  const list = useServerFn(listRuns);
  const events = useServerFn(getRunEvents);
  const saveRetention = useServerFn(setRetention);
  const [view, setView] = useState<"list" | "gallery">("list");
  const [status, setStatus] = useState<RunStatus | "">("");
  const [days, setDays] = useState<number | 0>(0);
  const [page, setPage] = useState(0);
  const [rows, setRows] = useState<RunRow[]>([]);
  const [seesAll, setSeesAll] = useState(false);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<RunRow | null>(null);
  const [log, setLog] = useState<EventRow[]>([]);
  const [days2, setDays2] = useState(retention);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await list({
        data: { outputNodeId, page, ...(status ? { status } : {}), ...(days ? { days } : {}) },
      });
      setRows(res.runs);
      setSeesAll(res.seesAll);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Durchläufe nicht ladbar");
    } finally {
      setLoading(false);
    }
  }, [list, outputNodeId, page, status, days]);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  useEffect(() => {
    if (!selected) return;
    setLog([]);
    void events({ data: { runId: selected.id } })
      .then((res) => setLog(res.events))
      .catch(() => setLog([]));
  }, [selected, events]);

  const chip = (active: boolean) =>
    `rounded-full px-3 py-1 text-xs ${active ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground"}`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-3xl overflow-hidden">
        <DialogHeader>
          <DialogTitle>Durchläufe</DialogTitle>
          <DialogDescription>
            {seesAll ? "Alle Durchläufe an diesem Ausgang." : "Nur deine eigenen Durchläufe."} Eingaben werden nach{" "}
            {days2} Tagen gelöscht; der Nachweis bleibt ohne Personenbezug.
          </DialogDescription>
        </DialogHeader>

        {selected ? (
          <div className="flex max-h-[62vh] flex-col gap-3 overflow-auto">
            <button className="self-start text-xs text-muted-foreground hover:text-foreground" onClick={() => setSelected(null)}>
              ← Zurück zur Liste
            </button>
            <div className="grid gap-3 md:grid-cols-2">
              <div className="rounded-xl border p-3">
                <p className="mb-2 text-xs font-medium text-muted-foreground">Ergebnis</p>
                <OutputView artifact={readOutput({ output: selected.result })} fileUrl={null} compact />
              </div>
              <div className="rounded-xl border p-3 text-xs">
                <p className="mb-2 font-medium text-muted-foreground">Nachweis</p>
                <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
                  <dt className="text-muted-foreground">Person</dt><dd>{selected.who}</dd>
                  <dt className="text-muted-foreground">Zeit</dt><dd>{when(selected.created_at)}</dd>
                  <dt className="text-muted-foreground">Status</dt><dd>{RUN_STATUS_LABEL[selected.status as RunStatus] ?? selected.status}</dd>
                  <dt className="text-muted-foreground">Motor</dt><dd>{[selected.engine, selected.provider, selected.model].filter(Boolean).join(" · ") || "–"}</dd>
                  <dt className="text-muted-foreground">Eingabe</dt>
                  <dd>
                    {selected.inputUrl ? <a className="underline" href={selected.inputUrl} target="_blank" rel="noreferrer">Datei öffnen</a> : selected.purged_at ? "gelöscht" : "keine Datei"}
                  </dd>
                  <dt className="text-muted-foreground">Prüfsumme</dt><dd className="truncate font-mono" title={selected.input_sha256 ?? ""}>{selected.input_sha256?.slice(0, 16) ?? "–"}</dd>
                  <dt className="text-muted-foreground">Löschung</dt><dd>{when(selected.expires_at)}</dd>
                </dl>
                {selected.error ? <p className="mt-2 text-destructive">{selected.error}</p> : null}
              </div>
            </div>
            <div className="rounded-xl border p-3 text-xs">
              <p className="mb-2 font-medium text-muted-foreground">Protokoll (unveränderlich)</p>
              <ul className="space-y-1">
                {log.map((e) => (
                  <li key={e.id} className="flex gap-3">
                    <span className="w-28 shrink-0 text-muted-foreground">{when(e.created_at)}</span>
                    <span>{ACTION_LABEL[e.action] ?? e.action}{e.detail ? ` – ${e.detail}` : ""}</span>
                    <span className="ml-auto text-muted-foreground">{e.system ? "System" : e.byMe ? "du" : "Mitglied"}</span>
                  </li>
                ))}
                {!log.length ? <li className="text-muted-foreground">…</li> : null}
              </ul>
            </div>
          </div>
        ) : (
          <div className="flex max-h-[62vh] flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <button className={chip(view === "list")} onClick={() => setView("list")}>Liste</button>
              <button className={chip(view === "gallery")} onClick={() => setView("gallery")}>Galerie</button>
              <span className="mx-1 h-4 w-px bg-border" />
              {(["", "done", "running", "failed"] as const).map((s) => (
                <button key={s || "all"} className={chip(status === s)} onClick={() => { setStatus(s); setPage(0); }}>
                  {s ? RUN_STATUS_LABEL[s] : "alle"}
                </button>
              ))}
              <select
                className="ml-auto rounded-full border bg-background px-2 py-1 text-xs"
                value={days}
                aria-label="Zeitraum"
                onChange={(e) => { setDays(Number(e.target.value)); setPage(0); }}
              >
                <option value={0}>jederzeit</option>
                <option value={1}>letzte 24 h</option>
                <option value={7}>letzte 7 Tage</option>
                <option value={30}>letzte 30 Tage</option>
              </select>
            </div>

            <div className="min-h-40 flex-1 overflow-auto">
              {loading ? <p className="py-8 text-center text-sm text-muted-foreground">…</p> : null}
              {!loading && !rows.length ? (
                <p className="py-8 text-center text-sm text-muted-foreground">Noch keine Durchläufe.</p>
              ) : null}
              {!loading && view === "list" ? (
                <ul className="divide-y">
                  {rows.map((r) => (
                    <li key={r.id}>
                      <button className="flex w-full items-center gap-3 px-1 py-2 text-left text-sm hover:bg-muted/50" onClick={() => setSelected(r)}>
                        <span className="w-28 shrink-0 text-xs text-muted-foreground">{when(r.created_at)}</span>
                        <span className="line-clamp-1 flex-1">{readOutput({ output: r.result }).title || readOutput({ output: r.result }).text.slice(0, 80) || "Ergebnis"}</span>
                        <span className="text-xs text-muted-foreground">{r.who}</span>
                        <span className={`rounded-full px-2 py-0.5 text-[10px] ${r.status === "failed" ? "bg-destructive/10 text-destructive" : "bg-muted"}`}>
                          {RUN_STATUS_LABEL[r.status as RunStatus] ?? r.status}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
              {!loading && view === "gallery" ? (
                <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
                  {rows.map((r) => (
                    <button key={r.id} className="flex h-40 flex-col overflow-hidden rounded-xl border text-left hover:border-ring/60" onClick={() => setSelected(r)}>
                      {r.inputUrl && r.input_mime?.startsWith("image/") ? (
                        <img src={r.inputUrl} alt="Eingabe" className="h-24 w-full object-cover" loading="lazy" />
                      ) : (
                        <div className="h-24 overflow-hidden p-2 text-[11px] text-muted-foreground">
                          {readOutput({ output: r.result }).text.slice(0, 160) || "Ergebnis"}
                        </div>
                      )}
                      <div className="mt-auto border-t px-2 py-1 text-[10px] text-muted-foreground">
                        {when(r.created_at)} · {RUN_STATUS_LABEL[r.status as RunStatus] ?? r.status}
                      </div>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>

            <div className="flex items-center gap-2 border-t pt-2 text-xs">
              <Button size="sm" variant="ghost" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>Zurück</Button>
              <Button size="sm" variant="ghost" disabled={rows.length < 50} onClick={() => setPage((p) => p + 1)}>Weiter</Button>
              {seesAll ? (
                <label className="ml-auto flex items-center gap-2 text-muted-foreground">
                  Löschfrist
                  <select
                    className="rounded-full border bg-background px-2 py-1"
                    value={days2}
                    onChange={async (e) => {
                      const d = Number(e.target.value) as 7 | 30 | 90;
                      try {
                        await saveRetention({ data: { outputNodeId, days: d } });
                        setDays2(d);
                        toast.success(`Löschfrist: ${d} Tage`);
                        void load();
                      } catch (err) {
                        toast.error(err instanceof Error ? err.message : "Nicht gespeichert");
                      }
                    }}
                  >
                    {RETENTION_CHOICES.map((d) => <option key={d} value={d}>{d} Tage</option>)}
                  </select>
                </label>
              ) : null}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
