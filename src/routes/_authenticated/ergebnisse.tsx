import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArrowLeft, ImageIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { OutputView } from "@/components/OutputView";
import { getRunEvents, myResults } from "@/lib/runs.functions";
import { NEVER, RUN_STATUS_LABEL, type RunStatus } from "@/lib/runs";
import { readOutput } from "@/lib/output";

export const Route = createFileRoute("/_authenticated/ergebnisse")({
  head: () => ({
    meta: [
      { title: "Ergebnisse – scopebuilder" },
      {
        name: "description",
        content:
          "Alle Ergebnisse und ihre Durchläufe an einem Ort: filtern, öffnen und den Nachweis je Durchlauf einsehen.",
      },
      { property: "og:title", content: "Ergebnisse – scopebuilder" },
      {
        property: "og:description",
        content: "Deine Ergebnisse aus allen Scopes, mit Eingabe, Motor und Protokoll je Durchlauf.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: ResultsPage,
});

type RunRow = Awaited<ReturnType<typeof myResults>>["runs"][number];
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

function ResultsPage() {
  const load = useServerFn(myResults);
  const events = useServerFn(getRunEvents);
  const [status, setStatus] = useState<RunStatus | "">("");
  const [days, setDays] = useState(0);
  const [boardId, setBoardId] = useState("");
  const [mineOnly, setMineOnly] = useState(false);
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<RunRow | null>(null);
  const [log, setLog] = useState<EventRow[]>([]);

  const query = useQuery({
    queryKey: ["my-results", status, days, boardId, mineOnly, page],
    queryFn: () =>
      load({
        data: {
          mineOnly,
          page,
          ...(status ? { status } : {}),
          ...(days ? { days } : {}),
          ...(boardId ? { boardId } : {}),
        },
      }),
  });

  useEffect(() => {
    if (!selected) return;
    setLog([]);
    void events({ data: { runId: selected.id } })
      .then((res) => setLog(res.events))
      .catch(() => setLog([]));
  }, [selected, events]);

  const chip = (active: boolean) =>
    `shrink-0 rounded-full px-3 py-1.5 text-xs ${active ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`;

  const rows = query.data?.runs ?? [];
  const pageSize = query.data?.pageSize ?? 24;
  const total = query.data?.total ?? 0;

  return (
    <main className="mx-auto w-full max-w-5xl px-4 pb-24 pt-4 sm:px-6">
      <header className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-3">
        <Button asChild size="icon" variant="ghost" aria-label="Zurück">
          <Link to="/">
            <ArrowLeft className="h-5 w-5" />
          </Link>
        </Button>
        <div className="min-w-0">
          <h1 className="truncate text-xl font-semibold sm:text-2xl">Ergebnisse</h1>
          <p className="truncate text-xs text-muted-foreground">
            {total} {total === 1 ? "Durchlauf" : "Durchläufe"} aus deinen Scopes
          </p>
        </div>
      </header>

      <div className="-mx-4 mt-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0">
        {(["", "done", "running", "failed"] as const).map((s) => (
          <button
            key={s || "all"}
            className={chip(status === s)}
            onClick={() => {
              setStatus(s);
              setPage(0);
            }}
          >
            {s ? RUN_STATUS_LABEL[s] : "alle"}
          </button>
        ))}
        <button
          className={chip(mineOnly)}
          onClick={() => {
            setMineOnly((v) => !v);
            setPage(0);
          }}
        >
          nur meine
        </button>
        <select
          className="shrink-0 rounded-full border bg-background px-3 py-1.5 text-xs"
          aria-label="Zeitraum"
          value={days}
          onChange={(e) => {
            setDays(Number(e.target.value));
            setPage(0);
          }}
        >
          <option value={0}>jederzeit</option>
          <option value={1}>letzte 24 h</option>
          <option value={7}>letzte 7 Tage</option>
          <option value={30}>letzte 30 Tage</option>
        </select>
        <select
          className="shrink-0 rounded-full border bg-background px-3 py-1.5 text-xs"
          aria-label="Scope"
          value={boardId}
          onChange={(e) => {
            setBoardId(e.target.value);
            setPage(0);
          }}
        >
          <option value="">alle Scopes</option>
          {(query.data?.scopes ?? []).map((s) => (
            <option key={s.id} value={s.id}>
              {s.title || "Ohne Titel"}
            </option>
          ))}
        </select>
      </div>

      {query.isLoading ? <p className="py-12 text-center text-sm text-muted-foreground">…</p> : null}
      {query.isError ? (
        <p className="py-12 text-center text-sm text-destructive">Ergebnisse nicht ladbar.</p>
      ) : null}
      {!query.isLoading && !rows.length ? (
        <p className="py-12 text-center text-sm text-muted-foreground">
          Noch keine Ergebnisse. Lege in einem Scope ein Ergebnis-Modul an.
        </p>
      ) : null}

      <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {rows.map((r) => {
          const art = readOutput({ output: r.result });
          const image = r.inputUrl && r.input_mime?.startsWith("image/") ? r.inputUrl : null;
          return (
            <li key={r.id}>
              <button
                className="flex w-full flex-col overflow-hidden rounded-2xl border bg-card text-left transition hover:border-ring/60 active:scale-[0.99]"
                onClick={() => setSelected(r)}
              >
                {image ? (
                  <img src={image} alt="" loading="lazy" className="aspect-[4/3] w-full object-cover" />
                ) : (
                  <div className="flex aspect-[4/3] w-full items-center overflow-hidden bg-muted/40 p-3 text-[11px] leading-snug text-muted-foreground">
                    {art.text ? (
                      <span className="line-clamp-5">{art.text.slice(0, 200)}</span>
                    ) : (
                      <ImageIcon className="mx-auto h-6 w-6 opacity-40" />
                    )}
                  </div>
                )}
                <div className="min-w-0 space-y-0.5 p-3">
                  <p className="truncate text-sm font-medium">{art.title || r.outputTitle}</p>
                  <p className="truncate text-[11px] text-muted-foreground">{r.boardTitle}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {when(r.created_at)} · {RUN_STATUS_LABEL[r.status as RunStatus] ?? r.status}
                  </p>
                </div>
              </button>
            </li>
          );
        })}
      </ul>

      {total > pageSize ? (
        <div className="mt-6 flex items-center justify-center gap-2">
          <Button size="sm" variant="ghost" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
            Zurück
          </Button>
          <span className="text-xs text-muted-foreground">
            Seite {page + 1} von {Math.ceil(total / pageSize)}
          </span>
          <Button
            size="sm"
            variant="ghost"
            disabled={(page + 1) * pageSize >= total}
            onClick={() => setPage((p) => p + 1)}
          >
            Weiter
          </Button>
        </div>
      ) : null}

      <Sheet open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <SheetContent side="bottom" className="max-h-[92vh] overflow-auto rounded-t-2xl sm:max-w-2xl">
          {selected ? (
            <>
              <SheetHeader className="text-left">
                <SheetTitle className="truncate">
                  {readOutput({ output: selected.result }).title || selected.outputTitle}
                </SheetTitle>
                <p className="text-xs text-muted-foreground">
                  {selected.boardTitle} · {when(selected.created_at)}
                </p>
              </SheetHeader>

              <div className="mt-4 space-y-4">
                <div className="rounded-xl border p-3">
                  <OutputView artifact={readOutput({ output: selected.result })} fileUrl={null} compact />
                </div>

                <div className="rounded-xl border p-3 text-xs">
                  <p className="mb-2 font-medium text-muted-foreground">Nachweis</p>
                  <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
                    <dt className="text-muted-foreground">Status</dt>
                    <dd>{RUN_STATUS_LABEL[selected.status as RunStatus] ?? selected.status}</dd>
                    <dt className="text-muted-foreground">Motor</dt>
                    <dd className="truncate">
                      {[selected.engine, selected.provider, selected.model].filter(Boolean).join(" · ") || "–"}
                    </dd>
                    <dt className="text-muted-foreground">Eingabe</dt>
                    <dd>
                      {selected.inputUrl ? (
                        <a className="underline" href={selected.inputUrl} target="_blank" rel="noreferrer">
                          Datei öffnen
                        </a>
                      ) : selected.purged_at ? (
                        "gelöscht"
                      ) : (
                        "keine Datei"
                      )}
                    </dd>
                    <dt className="text-muted-foreground">Löschung</dt>
                    <dd>
                      {!selected.expires_at || selected.expires_at === NEVER || selected.expires_at.startsWith("9999")
                        ? "nie"
                        : when(selected.expires_at)}
                    </dd>
                  </dl>
                  {selected.error ? <p className="mt-2 text-destructive">{selected.error}</p> : null}
                </div>

                <div className="rounded-xl border p-3 text-xs">
                  <p className="mb-2 font-medium text-muted-foreground">Protokoll (unveränderlich)</p>
                  <ul className="space-y-1">
                    {log.map((e) => (
                      <li key={e.id} className="flex flex-wrap gap-x-3">
                        <span className="text-muted-foreground">{when(e.created_at)}</span>
                        <span>
                          {ACTION_LABEL[e.action] ?? e.action}
                          {e.detail ? ` – ${e.detail}` : ""}
                        </span>
                      </li>
                    ))}
                    {!log.length ? <li className="text-muted-foreground">…</li> : null}
                  </ul>
                </div>

                <Button asChild variant="outline" className="w-full">
                  <Link to="/board/$boardId" params={{ boardId: selected.board_id }}>
                    Im Scope öffnen
                  </Link>
                </Button>
              </div>
            </>
          ) : null}
        </SheetContent>
      </Sheet>
    </main>
  );
}
