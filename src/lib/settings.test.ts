import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, settingsFrom, withAppearance } from "./settings";

describe("settingsFrom", () => {
  it("bewahrt gespeicherte Theme- und Spracheinstellungen", () => {
    expect(settingsFrom({ theme: "dark", language: "en" })).toMatchObject({
      theme: "dark",
      language: "en",
    });
    expect(settingsFrom({ theme: "light", language: "de" })).toMatchObject({
      theme: "light",
      language: "de",
    });
    expect(settingsFrom({ theme: "system", language: "system" })).toMatchObject({
      theme: "system",
      language: "system",
    });
  });

  it("ersetzt ungültige gespeicherte Werte durch sichere Vorgaben", () => {
    expect(settingsFrom({ theme: "contrast", language: "fr" })).toMatchObject({
      theme: DEFAULT_SETTINGS.theme,
      language: DEFAULT_SETTINGS.language,
    });
  });

  it("ändert nur Theme oder Sprache und bewahrt alle übrigen Kontoeinstellungen", () => {
    const stored = { ...DEFAULT_SETTINGS, autoSave: false, gridDefault: false };
    const themed = withAppearance(stored, { theme: "dark" });
    const translated = withAppearance(themed, { language: "en" });

    expect(translated).toEqual({
      ...stored,
      theme: "dark",
      language: "en",
    });
  });
});