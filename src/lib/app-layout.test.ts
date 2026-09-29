import { describe, expect, it } from "vitest";
import {
  APP_LAYOUTS,
  alignFreeLayout,
  buildFreeLayout,
  resolveLayout,
  snapFreeLayout,
  TILE_TYPES,
  updateFreeLayout,
  WIDE_TYPES,
} from "@/lib/app-layout";
import { brandingFrom } from "@/lib/apps";
import { DEFAULT_APP_BRANDING } from "@/lib/zones";
import { mapNode, metricNode, riskNode } from "@/test/nodes";

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

  it("liest die freie Modulpositionierung wieder ein", () => {
    const moduleLayout = [{ id: "metric", col: 3, row: 2, width: 5, height: 4 }];
    const read = brandingFrom({ ...DEFAULT_APP_BRANDING, layout: "free", moduleLayout });
    expect(read.layout).toBe("free");
    expect(read.moduleLayout).toEqual(moduleLayout);
  });
});

describe("freie Fläche", () => {
  it("ordnet neue Module ohne Überlappung an", () => {
    const layout = buildFreeLayout([metricNode, mapNode, riskNode], []);
    expect(layout).toHaveLength(3);
    expect(new Set(layout.map((item) => `${item.col}:${item.row}`)).size).toBe(3);
  });

  it("speichert eine gültige Verschiebung und verhindert Kollisionen", () => {
    const layout = [
      { id: metricNode.id, col: 1, row: 1, width: 4, height: 3 },
      { id: mapNode.id, col: 7, row: 1, width: 6, height: 5 },
    ];
    expect(updateFreeLayout(layout, metricNode.id, { col: 2 })[0]?.col).toBe(2);
    expect(updateFreeLayout(layout, metricNode.id, { col: 7 })).toEqual(layout);
  });

  it("ändert die Modulgröße innerhalb der zwölf Spalten", () => {
    const layout = [{ id: metricNode.id, col: 5, row: 1, width: 4, height: 3 }];
    const resized = updateFreeLayout(layout, metricNode.id, { width: 9, height: 6 });
    expect(resized[0]).toMatchObject({ col: 4, width: 9, height: 6 });
  });

  it("rastet an der Kante eines benachbarten Moduls ein", () => {
    const layout = [
      { id: metricNode.id, col: 1, row: 1, width: 3, height: 3 },
      { id: mapNode.id, col: 7, row: 5, width: 4, height: 4 },
    ];
    const result = snapFreeLayout(layout, metricNode.id, { col: 5, row: 1 }, "move", true);
    expect(result.layout[0]?.col).toBe(4);
    expect(result.guides.vertical).toBe(7);
  });

  it("richtet ausgewählte Module links aus, sofern keine Kollision entsteht", () => {
    const layout = [
      { id: metricNode.id, col: 2, row: 1, width: 3, height: 2 },
      { id: mapNode.id, col: 7, row: 5, width: 4, height: 4 },
    ];
    const aligned = alignFreeLayout(layout, [metricNode.id, mapNode.id], "left");
    expect(aligned.map((item) => item.col)).toEqual([2, 2]);
  });

  it("verwirft eine Ausrichtung, die Module überlagern würde", () => {
    const layout = [
      { id: metricNode.id, col: 1, row: 1, width: 3, height: 3 },
      { id: mapNode.id, col: 6, row: 1, width: 4, height: 3 },
    ];
    expect(alignFreeLayout(layout, [metricNode.id, mapNode.id], "left")).toEqual(layout);
  });
});

describe("Anordnung je Gerät", () => {
  const grid = (id: string, col: number, row: number, width: number, height: number) => ({ id, col, row, width, height });
  it("ordnet Fensterbreiten den Geräteklassen zu", () => {
    expect(deviceForWidth(390)).toBe("mobile");
    expect(deviceForWidth(767)).toBe("mobile");
    expect(deviceForWidth(768)).toBe("tablet");
    expect(deviceForWidth(1023)).toBe("tablet");
    expect(deviceForWidth(1024)).toBe("desktop");
  });
  it("wählt die gespeicherte Anordnung je Gerät", () => {
    const desk = [grid("a", 1, 1, 8, 4)];
    const tab = [grid("a", 1, 1, 12, 4)];
    expect(savedLayoutFor("desktop", desk, { tablet: tab })).toBe(desk);
    expect(savedLayoutFor("tablet", desk, {})).toBe(desk);
    expect(savedLayoutFor("tablet", desk, { tablet: tab })).toBe(tab);
    expect(savedLayoutFor("mobile", desk, undefined)).toEqual([]);
  });
  it("hält auf dem Handy mindestens halbe Breite", () => {
    const layout = [grid("a", 1, 1, 12, 2)];
    expect(updateFreeLayout(layout, "a", { width: 3 }, minModuleWidth("mobile"))[0]!.width).toBe(6);
    expect(updateFreeLayout(layout, "a", { width: 3 })[0]!.width).toBe(3);
  });
});
