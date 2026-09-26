/** Restaurants in der Nähe eines Fotostandorts (Daten: OpenStreetMap). */
export type Place = {
  id: string;
  name: string;
  lat: number;
  lon: number;
  cuisine: string;
  /** Entfernung zum Foto in Metern. */
  distance: number;
  url: string;
};

export function distanceMeters(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return Math.round(2 * 6_371_000 * Math.asin(Math.sqrt(h)));
}

/** Liest eine Overpass-Antwort defensiv; unbenannte Orte fallen weg. */
export function parsePlaces(raw: unknown, origin: { lat: number; lon: number }, limit = 15): Place[] {
  const elements = (raw as { elements?: unknown[] })?.elements;
  if (!Array.isArray(elements)) return [];
  const places: Place[] = [];
  for (const entry of elements) {
    const el = (entry ?? {}) as Record<string, unknown>;
    const tags = (el["tags"] ?? {}) as Record<string, unknown>;
    const center = (el["center"] ?? {}) as Record<string, unknown>;
    const lat = Number(el["lat"] ?? center["lat"]);
    const lon = Number(el["lon"] ?? center["lon"]);
    const name = typeof tags["name"] === "string" ? tags["name"].slice(0, 120) : "";
    if (!name || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const type = String(el["type"] ?? "node");
    const id = String(el["id"] ?? "");
    places.push({
      id: `${type}/${id}`,
      name,
      lat,
      lon,
      cuisine: typeof tags["cuisine"] === "string" ? tags["cuisine"].replace(/;/g, ", ").slice(0, 60) : "",
      distance: distanceMeters(origin, { lat, lon }),
      url: `https://www.openstreetmap.org/${encodeURIComponent(type)}/${encodeURIComponent(id)}`,
    });
  }
  return places.sort((a, b) => a.distance - b.distance).slice(0, limit);
}
