import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Camera, Crosshair, Loader2, MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { NodeRecord } from "@/components/canvas/board-context";
import { OutputView } from "@/components/OutputView";
import { downscale, exifLocation } from "@/lib/inspection";
import { runCameraFlow } from "@/lib/flow.functions";
import { EMPTY_ARTIFACT } from "@/lib/output";
import type { GeoPoint } from "@/lib/geo";

const LeafletMap = lazy(() => import("@/components/canvas/LeafletMap"));

type FlowResult = Awaited<ReturnType<typeof runCameraFlow>>;

/**
 * Allgemeine App-Bühne für Scopes mit Kamera-Quelle. Sie zeigt genau die Module
 * der App in ihrer Reihenfolge; was passiert, bestimmt die Verkabelung im Scope.
 */
export function CameraApp({ appId, nodes }: { appId: string; nodes: NodeRecord[] }) {
  const camera = nodes.find((node) => node.type === "camera")!;
  const fileRef = useRef<HTMLInputElement>(null);
  const [photo, setPhoto] = useState<string | null>(null);
  const [pos, setPos] = useState<{ lat: number; lon: number; source: "exif" | "geraet" | "manuell" } | null>(null);
  const [busy, setBusy] = useState<"" | "locate" | "run">("");
  const [result, setResult] = useState<FlowResult | null>(null);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const run = async (next: { lat: number; lon: number; source: "exif" | "geraet" | "manuell" }) => {
    setPos(next);
    setBusy("run");
    try {
      setResult(await runCameraFlow({ data: { appId, cameraId: camera.id, ...next } }));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Ablauf fehlgeschlagen");
    } finally {
      setBusy("");
    }
  };

  const locate = () => {
    if (!navigator.geolocation) {
      toast.error("Dieses Gerät gibt den Standort nicht frei");
      return;
    }
    setBusy("locate");
    navigator.geolocation.getCurrentPosition(
      (p) => void run({ lat: Number(p.coords.latitude.toFixed(6)), lon: Number(p.coords.longitude.toFixed(6)), source: "geraet" }),
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
      setPhoto(await downscale(file, 720, 0.7));
      setResult(null);
      const gps = await exifLocation(file);
      if (gps) void run({ lat: Number(gps.lat.toFixed(6)), lon: Number(gps.lon.toFixed(6)), source: "exif" });
      else {
        toast.message("Im Foto ist kein Ort gespeichert – nehme den Standort des Geräts");
        locate();
      }
    } catch {
      toast.error("Foto konnte nicht gelesen werden");
    }
  };

  const points: GeoPoint[] = pos
    ? [
        { id: "foto", label: "Foto", lat: pos.lat, lon: pos.lon, klass: "Foto", impact: null, color: "#2563eb", photo },
        ...(result?.steps ?? []).flatMap((step) =>
          step.points.map((p) => ({
            id: `${step.nodeId}:${p.id}`,
            label: `${p.label}${p.distance !== null ? ` · ${p.distance} m` : ""}`,
            lat: p.lat,
            lon: p.lon,
            klass: step.title,
            impact: null,
            color: "#ea580c",
            note: p.note,
          })),
        ),
      ]
    : [];

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
      {nodes.map((node) => {
        if (node.type === "camera") {
          return (
            <section key={node.id} className="rounded-xl border border-border/70 bg-card p-4 shadow-[var(--shadow-card)]">
              <span className="module-eyebrow text-muted-foreground">{node.title || "Kamera"}</span>
              {photo ? (
                <img src={photo} alt="Aufgenommenes Foto" className="mt-3 aspect-[4/3] w-full rounded-lg object-cover" />
              ) : (
                <div className="mt-3 flex aspect-[4/3] w-full items-center justify-center rounded-lg border border-dashed border-border text-sm text-muted-foreground">
                  Noch kein Foto
                </div>
              )}
              <div className="mt-3 grid gap-2">
                <Button className="h-12 gap-2 text-base" onClick={() => fileRef.current?.click()} disabled={busy !== ""}>
                  {busy === "run" ? <Loader2 className="size-5 animate-spin" /> : <Camera className="size-5" />}
                  {photo ? "Neues Foto" : "Foto aufnehmen"}
                </Button>
                <Button variant="outline" className="h-11 gap-2" onClick={locate} disabled={busy !== ""}>
                  {busy === "locate" ? <Loader2 className="size-4 animate-spin" /> : <Crosshair className="size-4" />}
                  Nur Standort verwenden
                </Button>
              </div>
              {pos && (
                <p className="mt-2 flex items-center gap-1 text-xs text-muted-foreground">
                  <MapPin className="size-3" /> {pos.lat.toFixed(4)}, {pos.lon.toFixed(4)} ·{" "}
                  {pos.source === "exif" ? "aus dem Foto" : "vom Gerät"}
                </p>
              )}
              <p className="mt-2 text-[11px] text-muted-foreground">
                Das Foto bleibt auf Ihrem Gerät. Weitergegeben wird nur der Ort.
              </p>
            </section>
          );
        }
        if (node.type === "map") {
          return (
            <section key={node.id} className="rounded-xl border border-border/70 bg-card p-4 shadow-[var(--shadow-card)]">
              <span className="module-eyebrow text-muted-foreground">{node.title || "Karte"}</span>
              <div className="mt-3 h-64 overflow-hidden rounded-lg border border-border/70">
                {mounted && pos ? (
                  <Suspense fallback={<div className="h-full bg-secondary" />}>
                    <LeafletMap key={`${pos.lat},${pos.lon}`} points={points} weather={{}} center={[pos.lat, pos.lon]} zoom={15} selectedId="foto" />
                  </Suspense>
                ) : (
                  <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                    Erscheint nach dem Foto
                  </div>
                )}
              </div>
              <p className="mt-2 text-[11px] text-muted-foreground">Karte: © OpenStreetMap-Mitwirkende</p>
            </section>
          );
        }
        if (node.type === "output") {
          const out = result?.outputs.find((o) => o.nodeId === node.id);
          return (
            <section key={node.id} className="rounded-xl border border-border/70 bg-card p-4 shadow-[var(--shadow-card)]">
              <span className="module-eyebrow text-muted-foreground">{node.title || "Ergebnis"}</span>
              <div className="mt-3">
                {busy === "run" ? (
                  <p className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="size-4 animate-spin" /> Läuft …
                  </p>
                ) : out ? (
                  <OutputView artifact={{ ...EMPTY_ARTIFACT, kind: "text", title: node.title ?? "", text: out.text }} fileUrl={null} compact />
                ) : (
                  <p className="text-sm text-muted-foreground">Noch kein Durchlauf.</p>
                )}
              </div>
            </section>
          );
        }
        return null;
      })}
    </main>
  );
}
