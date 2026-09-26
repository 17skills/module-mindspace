import { lazy, Suspense, useEffect, useState } from "react";
import { Loader2, MapPin, UtensilsCrossed } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { appNearbyRestaurants } from "@/lib/apps.functions";
import type { Place } from "@/lib/nearby";
import type { GeoPoint } from "@/lib/geo";

const LeafletMap = lazy(() => import("@/components/canvas/LeafletMap"));

/** Zeigt den Fotostandort auf der Karte und Restaurants im Umkreis von 1 km. */
export function NearbyPanel({
  appId,
  lat,
  lon,
  photo,
}: {
  appId: string;
  lat: number | null;
  lon: number | null;
  photo: string | null;
}) {
  const search = useServerFn(appNearbyRestaurants);
  const [places, setPlaces] = useState<Place[]>([]);
  const [state, setState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [message, setMessage] = useState("");
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // Suche nur, wenn sich der Standort spürbar ändert (ca. 10 m), mit kurzer Pause gegen Tippen.
  const key = lat !== null && lon !== null ? `${lat.toFixed(4)},${lon.toFixed(4)}` : "";
  useEffect(() => {
    if (!key || lat === null || lon === null) return;
    let alive = true;
    const timer = window.setTimeout(() => {
      setState("loading");
      search({ data: { appId, lat, lon, radius: 1000 } })
        .then((result) => {
          if (!alive) return;
          setPlaces(result.places);
          setMessage(result.error ?? "");
          setState(result.error ? "error" : "done");
        })
        .catch((err: unknown) => {
          if (!alive) return;
          setMessage(err instanceof Error ? err.message : "Suche fehlgeschlagen");
          setState("error");
        });
    }, 600);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, appId]);

  if (lat === null || lon === null) {
    return (
      <section className="rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">
        <span className="module-eyebrow">Ort & Restaurants</span>
        <p className="mt-1">Nach dem Foto erscheinen hier der Ort auf der Karte und Restaurants in der Nähe.</p>
      </section>
    );
  }

  const points: GeoPoint[] = [
    { id: "foto", label: "Foto", lat, lon, klass: "Foto", impact: null, color: "#2563eb", photo },
    ...places.map((p) => ({
      id: p.id,
      label: `${p.name} · ${p.distance} m`,
      lat: p.lat,
      lon: p.lon,
      klass: "Restaurant",
      impact: null,
      color: "#ea580c",
      note: p.cuisine,
    })),
  ];

  return (
    <section className="rounded-xl border border-border/70 bg-card p-4 shadow-[var(--shadow-card)]">
      <div className="flex items-center justify-between">
        <span className="module-eyebrow text-muted-foreground">Ort & Restaurants</span>
        <span className="flex items-center gap-1 text-xs text-muted-foreground">
          <MapPin className="size-3" /> {lat.toFixed(4)}, {lon.toFixed(4)}
        </span>
      </div>
      <div className="mt-3 h-56 overflow-hidden rounded-lg border border-border/70">
        {mounted && (
          <Suspense fallback={<div className="h-full bg-secondary" />}>
            <LeafletMap points={points} weather={{}} center={[lat, lon]} zoom={15} selectedId="foto" />
          </Suspense>
        )}
      </div>
      <div className="mt-3">
        {state === "loading" && (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Suche Restaurants im Umkreis von 1 km …
          </p>
        )}
        {state === "error" && <p className="text-sm text-destructive">{message}</p>}
        {state === "done" && places.length === 0 && (
          <p className="text-sm text-muted-foreground">Keine Restaurants im Umkreis von 1 km gefunden.</p>
        )}
        {places.length > 0 && (
          <ul className="divide-y divide-border/70">
            {places.map((place) => (
              <li key={place.id}>
                <a
                  href={place.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-3 py-2"
                >
                  <UtensilsCrossed className="size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{place.name}</span>
                    {place.cuisine && (
                      <span className="block truncate text-xs text-muted-foreground">{place.cuisine}</span>
                    )}
                  </span>
                  <span className="font-mono text-xs text-muted-foreground">{place.distance} m</span>
                </a>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-[11px] text-muted-foreground">Daten: © OpenStreetMap-Mitwirkende</p>
      </div>
    </section>
  );
}
