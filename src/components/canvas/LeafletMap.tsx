import { useEffect } from "react";
import { CircleMarker, MapContainer, TileLayer, Tooltip, useMapEvents } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import type { GeoPoint, WeatherValue } from "@/lib/geo";

/** Colour of a point by rain intensity. */
function ringColor(weather: WeatherValue | undefined): string {
  const rain = weather?.rain ?? null;
  if (rain === null) return "#64748b";
  if (rain >= 25) return "#dc2626";
  if (rain >= 10) return "#ea580c";
  if (rain >= 2) return "#eab308";
  return "#16a34a";
}

/**
 * Meldet den sichtbaren Ausschnitt. Große Tabellen werden darüber nachgeladen:
 * der Server liefert nur die Punkte im Fenster, nie die ganze Tabelle.
 */
function BoundsWatcher({
  onBounds,
}: {
  onBounds: (box: [number, number, number, number]) => void;
}) {
  const map = useMapEvents({
    moveend: () => {
      const b = map.getBounds();
      onBounds([b.getSouth(), b.getWest(), b.getNorth(), b.getEast()]);
    },
  });
  useEffect(() => {
    const b = map.getBounds();
    onBounds([b.getSouth(), b.getWest(), b.getNorth(), b.getEast()]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}

export default function LeafletMap({
  points,
  weather,
  center,
  zoom,
  onSelect,
  selectedId,
  highlightIds,
  onBounds,
}: {
  points: GeoPoint[];
  weather: Record<string, WeatherValue>;
  center: [number, number];
  zoom: number;
  onSelect?: (id: string) => void;
  selectedId?: string | null;
  highlightIds?: string[];
  onBounds?: (box: [number, number, number, number]) => void;
}) {
  const focus = highlightIds && highlightIds.length ? new Set(highlightIds) : null;
  return (
    <MapContainer
      center={center}
      zoom={zoom}
      scrollWheelZoom
      style={{ height: "100%", width: "100%" }}
      className="nodrag nowheel"
    >
      <TileLayer
        attribution="&copy; OpenStreetMap"
        url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      {onBounds ? <BoundsWatcher onBounds={onBounds} /> : null}

      {points.map((point) => {
        const marked = focus ? focus.has(point.id) : false;
        const dimmed = focus ? !marked : false;
        const pinColor = point.color ?? ringColor(weather[point.id]);
        return (
          <CircleMarker
            key={point.id}
            center={[point.lat, point.lon]}
            radius={point.id === selectedId ? 10 : marked ? 9 : 7}
            pathOptions={{
              color: marked ? "#111827" : pinColor,
              weight: point.id === selectedId ? 4 : marked ? 3 : 2,
              fillColor: pinColor,
              fillOpacity: dimmed ? 0.12 : 0.55,
              opacity: dimmed ? 0.25 : 1,
            }}
            eventHandlers={{ click: () => onSelect?.(point.id) }}
          >
            <Tooltip>
              <span style={{ display: "block", maxWidth: 220, fontSize: 11 }}>
                {point.photo ? (
                  <img
                    src={point.photo}
                    alt={point.label}
                    style={{
                      display: "block",
                      width: "100%",
                      maxHeight: 120,
                      objectFit: "cover",
                      borderRadius: 6,
                      marginBottom: 4,
                    }}
                  />
                ) : null}
                <strong>{point.label}</strong>
                {point.klass ? ` · ${point.klass}` : ""}
                {point.note ? (
                  <span style={{ display: "block", marginTop: 2, color: "#475569" }}>
                    {point.note}
                  </span>
                ) : null}
                {weather[point.id]
                  ? ` · Regen ${weather[point.id]!.rain ?? "?"} mm/h · Wind ${weather[point.id]!.wind ?? "?"} km/h`
                  : ""}
              </span>
            </Tooltip>
          </CircleMarker>
        );
      })}
    </MapContainer>
  );
}
