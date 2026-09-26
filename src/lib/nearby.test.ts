import { describe, expect, it } from "vitest";
import { distanceMeters, parsePlaces } from "./nearby";

describe("parsePlaces", () => {
  const origin = { lat: 52.52, lon: 13.405 };
  it("sortiert nach Entfernung und verwirft Orte ohne Namen", () => {
    const places = parsePlaces(
      {
        elements: [
          { type: "node", id: 1, lat: 52.53, lon: 13.405, tags: { name: "Weit" } },
          { type: "way", id: 2, center: { lat: 52.521, lon: 13.405 }, tags: { name: "Nah", cuisine: "pizza;italian" } },
          { type: "node", id: 3, lat: 52.52, lon: 13.405, tags: {} },
        ],
      },
      origin,
    );
    expect(places.map((p) => p.name)).toEqual(["Nah", "Weit"]);
    expect(places[0]?.cuisine).toBe("pizza, italian");
    expect(places[0]?.url).toBe("https://www.openstreetmap.org/way/2");
  });
  it("übersteht kaputte Antworten", () => {
    expect(parsePlaces(null, origin)).toEqual([]);
    expect(parsePlaces({ elements: "x" }, origin)).toEqual([]);
  });
  it("rechnet Entfernungen plausibel", () => {
    expect(distanceMeters(origin, { lat: 52.53, lon: 13.405 })).toBeGreaterThan(1100);
  });
});
