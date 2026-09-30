import { act, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ThemeProvider, applyTheme, readStoredTheme, useTheme } from "./theme";

const listeners = new Set<() => void>();
let systemDark = false;

function installMatchMedia() {
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockImplementation(() => ({
      get matches() {
        return systemDark;
      },
      media: "(prefers-color-scheme: dark)",
      onchange: null,
      addEventListener: (_event: string, listener: () => void) => listeners.add(listener),
      removeEventListener: (_event: string, listener: () => void) => listeners.delete(listener),
      dispatchEvent: () => true,
    })),
  );
}

function ThemeHarness() {
  const { theme, setTheme } = useTheme();
  return (
    <>
      <output>{theme}</output>
      <button onClick={() => setTheme("light")}>light</button>
      <button onClick={() => setTheme("dark")}>dark</button>
      <button onClick={() => setTheme("system")}>system</button>
    </>
  );
}

describe("ThemeProvider", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.classList.remove("dark");
    document.documentElement.style.colorScheme = "";
    listeners.clear();
    systemDark = false;
    installMatchMedia();
  });

  it("liest nur gültige gespeicherte Einstellungen", () => {
    expect(readStoredTheme()).toBe("system");
    localStorage.setItem("scopebuilder.theme", "dark");
    expect(readStoredTheme()).toBe("dark");
    localStorage.setItem("scopebuilder.theme", "unbekannt");
    expect(readStoredTheme()).toBe("system");
  });

  it("wechselt zwischen hell und dunkel und speichert die Auswahl", async () => {
    render(<ThemeProvider><ThemeHarness /></ThemeProvider>);

    act(() => screen.getByRole("button", { name: "dark" }).click());
    expect(document.documentElement).toHaveClass("dark");
    expect(document.documentElement.style.colorScheme).toBe("dark");
    expect(localStorage.getItem("scopebuilder.theme")).toBe("dark");

    act(() => screen.getByRole("button", { name: "light" }).click());
    expect(document.documentElement).not.toHaveClass("dark");
    expect(document.documentElement.style.colorScheme).toBe("light");
    expect(localStorage.getItem("scopebuilder.theme")).toBe("light");
    await waitFor(() => expect(screen.getByText("light")).toBeInTheDocument());
  });

  it("folgt im Systemmodus der Gerätevorgabe und reagiert auf Änderungen", async () => {
    systemDark = true;
    localStorage.setItem("scopebuilder.theme", "system");
    render(<ThemeProvider><ThemeHarness /></ThemeProvider>);

    await waitFor(() => expect(document.documentElement).toHaveClass("dark"));
    expect(screen.getByText("system")).toBeInTheDocument();

    systemDark = false;
    act(() => listeners.forEach((listener) => listener()));
    expect(document.documentElement).not.toHaveClass("dark");
    expect(document.documentElement.style.colorScheme).toBe("light");
  });

  it("wendet die Systemvorgabe auch ohne Provider direkt an", () => {
    systemDark = true;
    applyTheme("system");
    expect(document.documentElement).toHaveClass("dark");
  });
});