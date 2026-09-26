import { describe, expect, it } from "vitest";
import { cleanInput, fillInputs, pointsReport, readPoints, readPointSpec } from "./flow";

describe("fillInputs", () => {
  it("setzt Zahlen ein", () => {
    expect(fillInputs("around:1000,{{input.lat}},{{ input.lon }}", { lat: 52.5, lon: 13.4 })).toBe(
      "around:1000,52.5,13.4",
    );
  });
  it("kodiert Werte in Adressen, damit sie Host und Parameter nicht ändern", () => {
    const url = fillInputs("https://api.example.com/q?x={{input.q}}", { q: "a&admin=1/../evil.com" }, "url");
    expect(new URL(url).host).toBe("api.example.com");
    expect(new URL(url).searchParams.get("admin")).toBeNull();
  });
  it("meldet fehlende Werte", () => {
    expect(() => fillInputs("{{input.lat}}", {})).toThrow(/lat/);
  });
  it("lässt nur saubere Eingaben durch", () => {
    expect(cleanInput({ lat: 1, "bad key": 2, s: "x\u0000y", o: { a: 1 }, n: Number.NaN })).toEqual({ lat: 1, s: "xy" });
  });
});

describe("readPoints", () => {
  const spec = readPointSpec({ list: "elements", lat: "lat|center.lat", lon: "lon|center.lon", label: "tags.name", note: "tags.cuisine" })!;
  const body = JSON.stringify({
    elements: [
      { lat: 52.53, lon: 13.405, tags: { name: "Weit" } },
      { center: { lat: 52.521, lon: 13.405 }, tags: { name: "Nah", cuisine: "pizza;italian" } },
      { lat: 52.52, lon: 13.405, tags: {} },
    ],
  });
  it("liest verschachtelte Felder, sortiert nach Entfernung, verwirft Unbenanntes", () => {
    const points = readPoints(body, spec, { lat: 52.52, lon: 13.405 });
    expect(points.map((p) => p.label)).toEqual(["Nah", "Weit"]);
    expect(points[0]?.note).toBe("pizza, italian");
    expect(pointsReport("Restaurants", points)).toContain("Nah – pizza, italian");
  });
  it("übersteht kaputte Antworten", () => {
    expect(readPoints("kein json", spec)).toEqual([]);
    expect(readPoints('{"elements":"x"}', spec)).toEqual([]);
  });
});
