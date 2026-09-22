import { createFileRoute } from "@tanstack/react-router";
import { ClientOnly } from "@tanstack/react-router";
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Camera, Crosshair, Loader2, MapPin, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { NodeRecord } from "@/components/canvas/board-context";
import {
  appAddFinding,
  appAssessPhoto,
  appSetFindingStatus,
  getPublicApp,
} from "@/lib/apps.functions";
import { brandingFrom } from "@/lib/apps";
import {
  clusterOf,
  downscale,
  euro,
  exifLocation,
  labelFromFile,
  priorityColor,
  readInspection,
  STATUS_COLOR,
  STATUS_VALUES,
  totalCost,
  type Finding,
} from "@/lib/inspection";
import { pointsFromSources, readMapConfig } from "@/lib/geo";

const LeafletMap = lazy(() => import("@/components/canvas/LeafletMap"));

export const Route = createFileRoute("/app/$appId")({
  head: () => ({
    meta: [
      { title: "Feld-App – Canvas Spark" },
      {
        name: "description",
        content:
          "Eigenständige App aus einem Canvas-Board: Fotos vor Ort erfassen oder das Lagebild mit Karte und Maßnahmenplan prüfen.",
      },
      { property: "og:title", content: "Feld-App – Canvas Spark" },
      {
        property: "og:description",
        content: "Mobile Erfassung und Lagebild-Cockpit aus einem Canvas-Board.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: AppStage,
});

type Loaded = Awaited<ReturnType<typeof getPublicApp>>;

function AppStage() {
  const { appId } = Route.useParams();
  const [data, setData] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () =>
    getPublicApp({ data: { appId } })
      .then(setData)
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : "App nicht verfügbar"),
      );

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appId]);

  if (error) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-2 px-6 text-center">
        <h1 className="font-display text-xl font-semibold">Kein Zugriff</h1>
        <p className="text-muted-foreground">{error}</p>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="flex min-h-screen items-center justify-center text-muted-foreground">…</div>
    );
  }

  const branding = brandingFrom(data.app.branding);
  const title = branding.title || data.app.title || "App";
  const nodes = JSON.parse(data.nodesJson) as NodeRecord[];

  return (
    <div
      className={`app-shell app-accent-${branding.accent} app-background-${branding.background} flex min-h-screen flex-col`}
    >
      <header className="app-header sticky top-0 z-20 flex min-h-16 items-center justify-between gap-3 border-b px-4 py-2.5">
        <div className="flex min-w-0 items-center gap-3">
          {branding.logo ? (
            <img
              src={branding.logo}
              alt=""
              className="app-brand-logo shrink-0 rounded-md bg-card object-contain p-1"
              style={{ width: branding.logoSize, height: branding.logoSize }}
            />
          ) : (
            <div className="app-logo-mark size-3 shrink-0 rounded-sm" aria-hidden />
          )}
          <div className="min-w-0">
            <span className="module-eyebrow block text-muted-foreground">
              {data.app.kind === "capture" ? "Vor-Ort-Erfassung" : "Lagebild"}
            </span>
            <span className="block truncate font-display text-base font-semibold">{title}</span>
          </div>
        </div>
        <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => void load()}>
          <RefreshCw className="size-3.5" />
          Aktualisieren
        </Button>
      </header>

      {data.app.kind === "capture" ? (
        <CaptureApp appId={appId} nodes={nodes} onSaved={() => void load()} />
      ) : (
        <CockpitApp appId={appId} nodes={nodes} onChanged={() => void load()} />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Mobile Erfassung                                                    */
/* ------------------------------------------------------------------ */

function CaptureApp({
  appId,
  nodes,
  onSaved,
}: {
  appId: string;
  nodes: NodeRecord[];
  onSaved: () => void;
}) {
  const inspect = nodes.find((node) => node.type === "inspect") ?? null;
  const findings = inspect ? readInspection(inspect).findings : [];
  const fileRef = useRef<HTMLInputElement>(null);
  const [photo, setPhoto] = useState<string | null>(null);
  const [label, setLabel] = useState("");
  const [report, setReport] = useState("");
  const [lat, setLat] = useState<number | null>(null);
  const [lon, setLon] = useState<number | null>(null);
  const [source, setSource] = useState<"exif" | "manuell" | "unbekannt">("unbekannt");
  const [busy, setBusy] = useState<"" | "locate" | "assess">("");
  const [online, setOnline] = useState(true);
  const [queue, setQueue] = useState<QueuedFinding[]>([]);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    setOnline(navigator.onLine);
    setQueue(queuedFor(appId));
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
    };
  }, [appId]);

  const uploadQueued = async (entry: QueuedFinding) => {
    const assessment =
      entry.assessment ??
      (await appAssessPhoto({
        data: { appId, image: entry.photo, label: entry.label, report: entry.report, rates: "" },
      }));
    await appAddFinding({
      data: {
        appId,
        finding: {
          label: assessment.label || entry.label || "Unbenanntes Objekt",
          lat: entry.lat,
          lon: entry.lon,
          category: assessment.category,
          finding: assessment.finding,
          priority: assessment.priority,
          action: assessment.action,
          cost: assessment.cost,
          confidence: assessment.confidence,
          reason: assessment.reason,
          thumb: entry.photo,
          source: entry.source,
        },
      },
    });
    dequeueFinding(entry.id);
  };

  const sync = async () => {
    const pending = queuedFor(appId);
    if (!pending.length || syncing) return;
    setSyncing(true);
    let done = 0;
    for (const entry of pending) {
      try {
        await uploadQueued(entry);
        done += 1;
      } catch {
        break;
      }
    }
    setQueue(queuedFor(appId));
    setSyncing(false);
    if (done > 0) {
      toast.success(`${done} Befund${done === 1 ? "" : "e"} übertragen`);
      onSaved();
    } else {
      toast.error("Übertragung nicht möglich – bitte später erneut versuchen");
    }
  };

  useEffect(() => {
    if (online && queue.length && !syncing) void sync();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online]);


  const locate = () => {
    if (!navigator.geolocation) {
      toast.error("Dieses Gerät gibt den Standort nicht frei");
      return;
    }
    setBusy("locate");
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLat(Number(position.coords.latitude.toFixed(6)));
        setLon(Number(position.coords.longitude.toFixed(6)));
        setSource("manuell");
        setBusy("");
        toast.success("Standort übernommen");
      },
      () => {
        setBusy("");
        toast.error("Standort konnte nicht ermittelt werden");
      },
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  };

  const pick = async (file: File | undefined) => {
    if (!file) return;
    try {
      const thumb = await downscale(file, 720, 0.7);
      setPhoto(thumb);
      if (!label) setLabel(labelFromFile(file.name));
      const gps = await exifLocation(file);
      if (gps) {
        setLat(Number(gps.lat.toFixed(6)));
        setLon(Number(gps.lon.toFixed(6)));
        setSource("exif");
      } else if (lat === null) {
        locate();
      }
    } catch {
      toast.error("Foto konnte nicht gelesen werden");
    }
  };

  const save = async () => {
    if (!photo) {
      toast.error("Bitte zuerst ein Foto aufnehmen");
      return;
    }
    setBusy("assess");
    try {
      const assessment = await appAssessPhoto({
        data: { appId, image: photo, label, report, rates: "" },
      });
      await appAddFinding({
        data: {
          appId,
          finding: {
            label: assessment.label || label || "Unbenanntes Objekt",
            lat,
            lon,
            category: assessment.category,
            finding: assessment.finding,
            priority: assessment.priority,
            action: assessment.action,
            cost: assessment.cost,
            confidence: assessment.confidence,
            reason: assessment.reason,
            thumb: photo,
            source,
          },
        },
      });
      toast.success(`Befund gespeichert · Prio ${Math.round(assessment.priority)}/10`);
      setPhoto(null);
      setLabel("");
      setReport("");
      setLat(null);
      setLon(null);
      setSource("unbekannt");
      if (fileRef.current) fileRef.current.value = "";
      onSaved();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Befund konnte nicht gespeichert werden");
    } finally {
      setBusy("");
    }
  };

  if (!inspect) {
    return (
      <p className="p-6 text-sm text-muted-foreground">
        Dieser App fehlt ein Inspektionsmodul. Bitte im Studio eines hinzufügen.
      </p>
    );
  }

  return (
    <main className="mx-auto w-full max-w-xl flex-1 space-y-4 px-4 py-5">
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(event) => void pick(event.target.files?.[0])}
      />

      <section className="rounded-xl border border-border/70 bg-card p-4 shadow-[var(--shadow-card)]">
        <span className="module-eyebrow text-muted-foreground">Neuer Befund</span>
        {photo ? (
          <img
            src={photo}
            alt="Aufgenommenes Foto"
            className="mt-3 aspect-[4/3] w-full rounded-lg object-cover"
          />
        ) : (
          <div className="mt-3 flex aspect-[4/3] w-full items-center justify-center rounded-lg border border-dashed border-border text-sm text-muted-foreground">
            Noch kein Foto
          </div>
        )}
        <div className="mt-3 grid gap-2">
          <Button className="h-12 gap-2 text-base" onClick={() => fileRef.current?.click()}>
            <Camera className="size-5" />
            {photo ? "Neues Foto aufnehmen" : "Foto aufnehmen"}
          </Button>
          <Button variant="outline" className="h-11 gap-2" onClick={locate} disabled={busy === "locate"}>
            {busy === "locate" ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Crosshair className="size-4" />
            )}
            Standort übernehmen
          </Button>
        </div>
        <div className="mt-3 grid gap-2">
          <Input
            value={label}
            placeholder="Station / Objekt"
            onChange={(event) => setLabel(event.target.value)}
          />
          <Input
            value={report}
            placeholder="Kurzbericht (optional)"
            onChange={(event) => setReport(event.target.value)}
          />
          <div className="grid grid-cols-2 gap-2">
            <Input
              value={lat ?? ""}
              inputMode="decimal"
              placeholder="Breitengrad"
              onChange={(event) => {
                const value = Number(event.target.value.replace(",", "."));
                setLat(event.target.value === "" || !Number.isFinite(value) ? null : value);
                setSource("manuell");
              }}
            />
            <Input
              value={lon ?? ""}
              inputMode="decimal"
              placeholder="Längengrad"
              onChange={(event) => {
                const value = Number(event.target.value.replace(",", "."));
                setLon(event.target.value === "" || !Number.isFinite(value) ? null : value);
                setSource("manuell");
              }}
            />
          </div>
        </div>
        <Button
          className="mt-3 h-12 w-full gap-2 text-base"
          onClick={() => void save()}
          disabled={busy === "assess" || !photo}
        >
          {busy === "assess" ? <Loader2 className="size-5 animate-spin" /> : null}
          Bewerten und speichern
        </Button>
        <p className="mt-2 text-xs text-muted-foreground">
          Die Bewertung schätzt Schadensklasse, Dringlichkeit (1–10) und Kosten.
        </p>
      </section>

      <section className="rounded-xl border border-border/70 bg-card p-4 shadow-[var(--shadow-card)]">
        <div className="flex items-center justify-between">
          <span className="module-eyebrow text-muted-foreground">Zuletzt erfasst</span>
          <span className="text-xs text-muted-foreground">{findings.length} Befunde</span>
        </div>
        <ul className="mt-3 space-y-2">
          {[...findings]
            .slice(-6)
            .reverse()
            .map((finding) => (
              <li key={finding.id} className="flex items-center gap-3">
                {finding.thumb ? (
                  <img src={finding.thumb} alt="" className="size-11 rounded-md object-cover" />
                ) : (
                  <div className="size-11 rounded-md bg-secondary" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{finding.label}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {finding.category} · {euro(finding.cost)}
                  </p>
                </div>
                <span
                  className="rounded-full px-2 py-0.5 font-mono text-[11px] text-white"
                  style={{ background: priorityColor(finding.priority) }}
                >
                  {finding.priority}
                </span>
              </li>
            ))}
          {findings.length === 0 && (
            <li className="text-sm text-muted-foreground">Noch nichts erfasst.</li>
          )}
        </ul>
      </section>
    </main>
  );
}

/* ------------------------------------------------------------------ */
/* Lagebild-Cockpit                                                    */
/* ------------------------------------------------------------------ */

function CockpitApp({
  appId,
  nodes,
  onChanged,
}: {
  appId: string;
  nodes: NodeRecord[];
  onChanged: () => void;
}) {
  const inspect = nodes.find((node) => node.type === "inspect") ?? null;
  const mapNode = nodes.find((node) => node.type === "map") ?? null;
  const findings = useMemo(() => (inspect ? readInspection(inspect).findings : []), [inspect]);
  const [selected, setSelected] = useState<string | null>(null);
  const [filter, setFilter] = useState<"alle" | "offen" | "sofort">("alle");

  const mapConfig = readMapConfig(mapNode);
  const points = useMemo(
    () => pointsFromSources(inspect ? [inspect] : [], mapConfig),
    [inspect, mapConfig],
  );
  const center: [number, number] = points.length
    ? [points[0]!.lat, points[0]!.lon]
    : mapConfig.center;

  const urgent = findings.filter((f) => f.priority <= 3 && f.status !== "erledigt");
  const open = findings.filter((f) => f.status !== "erledigt");
  const shown = findings
    .filter((f) =>
      filter === "alle" ? true : filter === "offen" ? f.status !== "erledigt" : f.priority <= 3,
    )
    .sort((a, b) => a.priority - b.priority);

  const setStatus = async (finding: Finding, status: Finding["status"]) => {
    if (!inspect) return;
    try {
      await appSetFindingStatus({
        data: { appId, nodeId: inspect.id, findingId: finding.id, status },
      });
      onChanged();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Status konnte nicht geändert werden");
    }
  };

  return (
    <main className="flex-1 space-y-4 p-4">
      <section className="grid gap-3 sm:grid-cols-3">
        <Kpi
          label="Sofortmaßnahmen (Prio 1–3)"
          value={String(urgent.length)}
          tone={urgent.length > 2 ? "#dc2626" : urgent.length > 0 ? "#ea580c" : "#16a34a"}
        />
        <Kpi label="Offene Befunde" value={String(open.length)} tone="#598381" />
        <Kpi label="Offene Kosten" value={euro(totalCost(open))} tone="#1C2321" />
      </section>

      <section className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
        <div className="h-[420px] overflow-hidden rounded-xl border border-border/70 bg-card shadow-[var(--shadow-card)]">
          <ClientOnly
            fallback={
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                Karte lädt …
              </div>
            }
          >
            <Suspense
              fallback={
                <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                  Karte lädt …
                </div>
              }
            >
              <LeafletMap
                points={points}
                weather={mapConfig.weather}
                center={center}
                zoom={points.length ? 11 : mapConfig.zoom}
                selectedId={selected}
                onSelect={setSelected}
              />
            </Suspense>
          </ClientOnly>
        </div>

        <div className="rounded-xl border border-border/70 bg-card p-4 shadow-[var(--shadow-card)]">
          <div className="flex items-center justify-between gap-2">
            <span className="module-eyebrow text-muted-foreground">Befunde</span>
            <div className="flex gap-1">
              {(["alle", "offen", "sofort"] as const).map((value) => (
                <button
                  key={value}
                  onClick={() => setFilter(value)}
                  className={`rounded-full border px-2 py-0.5 text-[11px] capitalize transition-colors ${
                    filter === value
                      ? "border-transparent bg-primary text-primary-foreground"
                      : "border-border text-muted-foreground hover:bg-accent"
                  }`}
                >
                  {value}
                </button>
              ))}
            </div>
          </div>
          <ul className="mt-3 max-h-[330px] space-y-2 overflow-auto pr-1">
            {shown.map((finding) => (
              <li
                key={finding.id}
                onClick={() => setSelected(finding.id)}
                className={`cursor-pointer rounded-lg border p-2 transition-colors ${
                  selected === finding.id ? "border-ring bg-accent/40" : "border-border/70"
                }`}
              >
                <div className="flex items-center gap-2">
                  {finding.thumb ? (
                    <img src={finding.thumb} alt="" className="size-12 rounded-md object-cover" />
                  ) : (
                    <div className="size-12 rounded-md bg-secondary" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{finding.label}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {finding.category} · {euro(finding.cost)} · {clusterOf(finding.priority)?.label}
                    </p>
                  </div>
                  <span
                    className="rounded-full px-2 py-0.5 font-mono text-[11px] text-white"
                    style={{ background: priorityColor(finding.priority) }}
                  >
                    {finding.priority}
                  </span>
                </div>
                {selected === finding.id && (
                  <div className="mt-2 space-y-2">
                    <p className="text-xs text-muted-foreground">
                      {finding.finding} → {finding.action}
                    </p>
                    {finding.lat != null && finding.lon != null && (
                      <p className="flex items-center gap-1 font-mono text-[11px] text-muted-foreground">
                        <MapPin className="size-3" />
                        {finding.lat.toFixed(4)}, {finding.lon.toFixed(4)}
                      </p>
                    )}
                    <div className="flex flex-wrap gap-1">
                      {STATUS_VALUES.map((status) => (
                        <button
                          key={status}
                          onClick={(event) => {
                            event.stopPropagation();
                            void setStatus(finding, status);
                          }}
                          className="rounded-full border px-2 py-0.5 text-[11px] transition-colors hover:bg-accent"
                          style={
                            finding.status === status
                              ? { background: STATUS_COLOR[status], color: "#fff", borderColor: "transparent" }
                              : undefined
                          }
                        >
                          {status}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </li>
            ))}
            {shown.length === 0 && (
              <li className="text-sm text-muted-foreground">Keine Befunde in dieser Ansicht.</li>
            )}
          </ul>
        </div>
      </section>

      <section className="rounded-xl border border-border/70 bg-card p-4 shadow-[var(--shadow-card)]">
        <span className="module-eyebrow text-muted-foreground">Maßnahmenplan</span>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          {["Sofortmaßnahme", "Mittelfristig", "Beobachtung"].map((name) => {
            const group = open.filter((f) => clusterOf(f.priority)?.label === name);
            return (
              <div key={name} className="rounded-lg border border-border/70 p-3">
                <p className="text-sm font-medium">{name}</p>
                <p className="font-mono text-2xl">{group.length}</p>
                <p className="text-xs text-muted-foreground">{euro(totalCost(group))}</p>
              </div>
            );
          })}
        </div>
      </section>
    </main>
  );
}

function Kpi({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div className="rounded-xl border border-border/70 bg-card p-4 shadow-[var(--shadow-card)]">
      <span className="module-eyebrow text-muted-foreground">{label}</span>
      <p className="mt-1 font-mono text-3xl" style={{ color: tone }}>
        {value}
      </p>
      <div className="mt-2 h-1 rounded-full" style={{ background: tone }} />
    </div>
  );
}
