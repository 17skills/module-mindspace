import { describe, expect, it } from "vitest";
import { EMPTY_CHART_CONFIG, type ChartConfig } from "@/lib/chart-config";
import {
  TEMPLATE_FORMAT,
  exportTemplates,
  parseTemplateImport,
  templateKey,
} from "./query-template-io";

const config: ChartConfig = { ...EMPTY_CHART_CONFIG, mode: "visual", groupBy: "stadt", fn: "count" };

describe("Abfragevorlagen Export/Import", () => {
  it("überträgt Vorlagen verlustfrei", () => {
    const json = exportTemplates([
      { title: "Je Stadt", config, columns: ["stadt"], category: "Umsatz", tags: ["regional"] },
    ]);
    const back = parseTemplateImport(json);
    expect(back.error).toBeUndefined();
    expect(back.skipped).toBe(0);
    expect(back.templates).toHaveLength(1);
    expect(back.templates[0]).toMatchObject({ title: "Je Stadt", columns: ["stadt"], category: "Umsatz", tags: ["regional"] });
    expect(back.templates[0]!.config.groupBy).toBe("stadt");
  });

  it("lehnt fremde Dateien und kaputtes JSON verständlich ab", () => {
    expect(parseTemplateImport("{nope").error).toMatch(/JSON/);
    expect(parseTemplateImport(JSON.stringify({ format: "x", templates: [] })).error).toMatch(/keine Export-Datei/);
    expect(
      parseTemplateImport(JSON.stringify({ format: TEMPLATE_FORMAT, version: 99, templates: [] })).error,
    ).toMatch(/neueren Version/);
  });

  it("überspringt ungültige Einträge statt sie zu übernehmen", () => {
    const text = JSON.stringify({
      format: TEMPLATE_FORMAT,
      version: 1,
      templates: [
        { title: "", config },
        { title: "Ohne Auswertung" },
        { title: "Gut", config, tags: ["A", "a", 5] },
      ],
    });
    const result = parseTemplateImport(text);
    expect(result.skipped).toBe(2);
    expect(result.templates.map((t) => t.title)).toEqual(["Gut"]);
    expect(result.templates[0]!.tags).toEqual(["a"]);
  });

  it("erkennt Duplikate über Name und Auswertung", () => {
    expect(templateKey({ title: " Je Stadt ", config })).toBe(templateKey({ title: "je stadt", config }));
  });
});
