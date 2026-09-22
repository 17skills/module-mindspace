import { describe, expect, it } from "vitest";
import { APP_LAYOUTS, resolveLayout, TILE_TYPES, WIDE_TYPES } from "@/lib/app-layout";
import { brandingFrom } from "@/lib/apps";
import { DEFAULT_APP_BRANDING } from "@/lib/zones";

describe("resolveLayout", () => {
  it("behält jede feste Auswahl bei", () => {
    for (const option of APP_LAYOUTS) {
      if (option.id === "auto") continue;
      expect(resolveLayout(option.id, ["metric"])).toBe(option.id);
    }
  });

  it("wählt automatisch geteilt, sobald eine Karte dabei ist", () => {
    expect(resolveLayout("auto", ["map", "inspect"])).toBe("split");
  });

  it("wählt Erfassung bei einem einzelnen Inspektionsmodul", () => {
    expect(resolveLayout("auto", ["inspect"])).toBe("capture");
  });

  it("wählt Kennzahlen-Raster bei Zahlen-Modulen", () => {
    expect(resolveLayout("auto", ["metric", "gauge"])).toBe("dashboard");
  });

  it("fällt sonst auf den Bericht zurück", () => {
    expect(resolveLayout("auto", ["text", "note"])).toBe("report");
  });
});

describe("Modulklassen", () => {
  it("trennt breite Module von Kacheln", () => {
    expect(WIDE_TYPES.has("map")).toBe(true);
    expect(TILE_TYPES.has("metric")).toBe(true);
    expect(WIDE_TYPES.has("metric")).toBe(false);
  });
});

describe("gespeicherte Konfiguration", () => {
  it("liest Aufbau und Gestaltung aus der Datenbankspalte zurück", () => {
    const stored = { ...DEFAULT_APP_BRANDING, layout: "dashboard", accent: "cobalt", title: "KPI" };
    const read = brandingFrom(stored);
    expect(read.layout).toBe("dashboard");
    expect(read.accent).toBe("cobalt");
    expect(read.title).toBe("KPI");
  });

  it("fällt bei unbekanntem Aufbau auf automatisch zurück", () => {
    expect(brandingFrom({ layout: "quatsch" }).layout).toBe("auto");
    expect(brandingFrom(null).layout).toBe("auto");
  });
});
