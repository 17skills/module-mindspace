import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Camera, CloudOff, Crosshair, Loader2, LockKeyhole, RefreshCw, UploadCloud } from "lucide-react";
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
import { AppEngine } from "@/components/app/AppEngine";
import { CameraApp } from "@/components/app/CameraApp";
import { resolveLayout } from "@/lib/app-layout";
import {
  downscale,
  euro,
  exifLocation,
  labelFromFile,
  priorityColor,
  readInspection,
} from "@/lib/inspection";
import { dequeueFinding, enqueueFinding, queuedFor, type QueuedFinding } from "@/lib/offline-queue";



export const Route = createFileRoute("/app/$appId")({
  head: () => ({
    meta: [
      { title: "Feld-App – scopebuilder" },
      {
        name: "description",
        content:
          "Eigenständige App aus einem Scope: Fotos vor Ort erfassen oder das Lagebild mit Karte und Maßnahmenplan prüfen.",
      },
      { property: "og:title", content: "Feld-App – scopebuilder" },
      {
        property: "og:description",
        content: "Mobile Erfassung und Lagebild-Cockpit aus einem Scope.",
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
  const canUpdateData = data.role === "data_editor" || data.role === "config_admin";

  return (
    <div
      className={`app-shell app-accent-${branding.accent} app-background-${branding.background} flex min-h-screen flex-col`}
      style={branding.accentColor ? ({ "--app-accent": branding.accentColor } as React.CSSProperties) : undefined}
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
              {resolveLayout(branding.layout, nodes.map((node) => node.type)) === "capture"
                ? "Vor-Ort-Erfassung"
                : "Scope-App"}
            </span>

            <span className="block truncate font-display text-base font-semibold">{title}</span>
          </div>
        </div>
        <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => void load()}>
          <RefreshCw className="size-3.5" />
          Aktualisieren
        </Button>
      </header>

      {nodes.some((node) => node.type === "camera") ? (
        <CameraApp appId={appId} nodes={nodes} />
      ) : resolveLayout(branding.layout, nodes.map((node) => node.type)) === "capture" ? (
        <CaptureApp appId={appId} nodes={nodes} canUpdateData={canUpdateData} onSaved={() => void load()} />
      ) : (
        <AppEngine
          nodes={nodes}
          layout={branding.layout}
          moduleLayout={branding.moduleLayout}
          deviceLayouts={branding.deviceLayouts}
          actions={canUpdateData ? {
            setStatus: (nodeId, finding, status) => {
              void appSetFindingStatus({
                data: { appId, nodeId, findingId: finding.id, status },
              })
                .then(() => load())
                .catch((err: unknown) =>
                  toast.error(
                    err instanceof Error ? err.message : "Status konnte nicht geändert werden",
                  ),
                );
            },
          } : undefined}
        />
      )}
      {!canUpdateData && (
        <div className="fixed bottom-4 left-1/2 z-30 flex -translate-x-1/2 items-center gap-2 rounded-full border bg-card px-4 py-2 text-xs shadow-lg">
          <LockKeyhole className="size-3.5" /> Nur Ansicht · Für Datenänderungen anmelden und freigeben lassen
        </div>
      )}

      {data.aiNotice ? (
        <footer className="border-t border-border/70 px-4 py-3 text-[11px] text-muted-foreground">
          {data.aiNotice}
        </footer>
      ) : null}
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
  canUpdateData,
}: {
  appId: string;
  nodes: NodeRecord[];
  onSaved: () => void;
  canUpdateData: boolean;
}) {
  const inspect = nodes.find((node) => node.type === "inspect") ?? null;
  const findings = inspect ? readInspection(inspect).findings : [];
  const fileRef = useRef<HTMLInputElement>(null);
  const [photo, setPhoto] = useState<string | null>(null);
  const [thumb, setThumb] = useState<string | null>(null);
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
          thumb: entry.thumb ?? entry.photo,
          photo: entry.photo,
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
      // Großes Bild für die Bewertung, kleines Bild für die Anzeige im Scope
      const [full, small] = await Promise.all([
        downscale(file, 720, 0.7),
        downscale(file, 200, 0.6),
      ]);
      setPhoto(full);
      setThumb(small);
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

  const clear = () => {
    setPhoto(null);
    setThumb(null);
    setLabel("");
    setReport("");
    setLat(null);
    setLon(null);
    setSource("unbekannt");
    if (fileRef.current) fileRef.current.value = "";
  };

  const save = async () => {
    if (!photo) {
      toast.error("Bitte zuerst ein Foto aufnehmen");
      return;
    }
    if (!online) {
      enqueueFinding({ appId, label, report, lat, lon, source, photo, thumb, assessment: null });
      setQueue(queuedFor(appId));
      toast.success("Ohne Netz gespeichert – wird später übertragen");
      clear();
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
            thumb: thumb ?? photo,
            photo,
            source,
          },
        },
      });
      toast.success(`Befund gespeichert · Prio ${Math.round(assessment.priority)}/10`);
      clear();
      onSaved();
    } catch {
      enqueueFinding({ appId, label, report, lat, lon, source, photo, thumb, assessment: null });
      setQueue(queuedFor(appId));
      toast.warning("Keine Verbindung – Befund liegt in der Warteschlange");
      clear();
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

      <section
        className={`flex items-center gap-3 rounded-xl border p-3 text-sm ${
          online ? "border-border/70 bg-card" : "border-[#E0682B]/50 bg-[#E0682B]/10"
        }`}
      >
        {online ? (
          <UploadCloud className="size-4 text-muted-foreground" />
        ) : (
          <CloudOff className="size-4 text-[#E0682B]" />
        )}
        <div className="min-w-0 flex-1">
          <p className="font-medium">
            {online ? "Verbunden" : "Ohne Netz"}
            {queue.length ? ` · ${queue.length} in der Warteschlange` : ""}
          </p>
          <p className="text-xs text-muted-foreground">
            {queue.length
              ? "Fotos bleiben auf dem Gerät, bis sie übertragen sind."
              : "Fotos gehen direkt an den Scope."}
          </p>
        </div>
        {queue.length > 0 && (
          <Button size="sm" variant="outline" disabled={!online || syncing} onClick={() => void sync()}>
            {syncing ? <Loader2 className="size-4 animate-spin" /> : null}
            Jetzt synchronisieren
          </Button>
        )}
      </section>

      {canUpdateData ? <section className="rounded-xl border border-border/70 bg-card p-4 shadow-[var(--shadow-card)]">
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
          {online ? "Bewerten und speichern" : "Ohne Netz sichern"}
        </Button>
        <p className="mt-2 text-xs text-muted-foreground">
          Die Bewertung schätzt Schadensklasse, Dringlichkeit (1–10) und Kosten.
        </p>
      </section> : <section className="rounded-xl border border-border/70 bg-card p-4 text-sm text-muted-foreground"><p className="font-medium text-foreground">Schreibgeschützte Ansicht</p><p className="mt-1">Zum Erfassen neuer Befunde brauchst du die Rolle „Daten aktualisieren“.</p></section>}

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

