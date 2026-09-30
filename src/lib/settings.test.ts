import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, settingsFrom } from "./settings";

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
});