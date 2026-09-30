import { act, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import {
  I18nProvider,
  readStoredLanguage,
  resolveLanguage,
  useTranslation,
} from "./index";

function LanguageHarness() {
  const { language, resolved, setLanguage, t, l, locale } = useTranslation();
  return (
    <>
      <output>{`${language}:${resolved}:${locale}`}</output>
      <p>{t("menu.settings")}</p>
      <p>{l("Aktive Apps")}</p>
      <button onClick={() => setLanguage("de")}>de</button>
      <button onClick={() => setLanguage("en")}>en</button>
      <button onClick={() => setLanguage("system")}>system</button>
    </>
  );
}

function setBrowserLanguage(value: string) {
  Object.defineProperty(window.navigator, "language", { configurable: true, value });
}

describe("I18nProvider", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.lang = "de";
    setBrowserLanguage("de-DE");
  });

  it("liest nur gültige gespeicherte Einstellungen", () => {
    expect(readStoredLanguage()).toBe("system");
    localStorage.setItem("scopebuilder.language", "en");
    expect(readStoredLanguage()).toBe("en");
    localStorage.setItem("scopebuilder.language", "fr");
    expect(readStoredLanguage()).toBe("system");
  });

  it("wechselt Sprache, Übersetzungen und Dokument-Sprache und speichert die Auswahl", async () => {
    render(<I18nProvider><LanguageHarness /></I18nProvider>);

    act(() => screen.getByRole("button", { name: "en" }).click());
    await waitFor(() => expect(document.documentElement.lang).toBe("en"));
    expect(screen.getByText("Settings")).toBeInTheDocument();
    expect(screen.getByText("Active apps")).toBeInTheDocument();
    expect(screen.getByText("en:en:en-GB")).toBeInTheDocument();
    expect(localStorage.getItem("scopebuilder.language")).toBe("en");

    act(() => screen.getByRole("button", { name: "de" }).click());
    await waitFor(() => expect(document.documentElement.lang).toBe("de"));
    expect(screen.getByText("Einstellungen")).toBeInTheDocument();
    expect(screen.getByText("Aktive Apps")).toBeInTheDocument();
    expect(localStorage.getItem("scopebuilder.language")).toBe("de");
  });

  it("übernimmt die englische Browsersprache im Systemmodus", async () => {
    setBrowserLanguage("en-US");
    localStorage.setItem("scopebuilder.language", "system");
    render(<I18nProvider><LanguageHarness /></I18nProvider>);

    await waitFor(() => expect(screen.getByText("system:en:en-GB")).toBeInTheDocument());
    expect(document.documentElement.lang).toBe("en");
    expect(screen.getByText("Settings")).toBeInTheDocument();
  });

  it("fällt bei anderen Browsersprachen auf Deutsch zurück", () => {
    setBrowserLanguage("fr-FR");
    expect(resolveLanguage("system")).toBe("de");
    expect(resolveLanguage("en")).toBe("en");
  });
});