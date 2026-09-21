import { CircleMarker, MapContainer, TileLayer, Tooltip } from "react-leaflet";
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

export default function LeafletMap({
  points,
  weather,
  center,
  zoom,
  onSelect,
  selectedId,
}: {
  points: GeoPoint[];
  weather: Record<string, WeatherValue>;
  center: [number, number];
  zoom: number;
  onSelect?: (id: string) => void;
  selectedId?: string | null;
}) {
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
      {points.map((point) => (
        <CircleMarker
          key={point.id}
          center={[point.lat, point.lon]}
          radius={point.id === selectedId ? 10 : 7}
          pathOptions={{
            color: ringColor(weather[point.id]),
            weight: point.id === selectedId ? 4 : 2,
            fillColor: ringColor(weather[point.id]),
            fillOpacity: 0.45,
          }}
          eventHandlers={{ click: () => onSelect?.(point.id) }}
        >
          <Tooltip>
            <span style={{ fontSize: 11 }}>
              <strong>{point.label}</strong>
              {point.klass ? ` · ${point.klass}` : ""}
              {weather[point.id]
                ? ` · Regen ${weather[point.id]!.rain ?? "?"} mm/h · Wind ${weather[point.id]!.wind ?? "?"} km/h`
                : ""}
            </span>
          </Tooltip>
        </CircleMarker>
      ))}
    </MapContainer>
  );
}
