/**
 * Erscheinungsbild (hell / dunkel / wie das Gerät).
 * Der gewählte Modus liegt lokal im Browser, damit die Seite ohne Flackern startet;
 * die Kontoeinstellung spiegelt ihn geräteübergreifend.
 */
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

export type ThemeMode = "light" | "dark" | "system";

const STORAGE_KEY = "scopebuilder.theme";

export function readStoredTheme(): ThemeMode {
  if (typeof window === "undefined") return "system";
  const raw = window.localStorage.getItem(STORAGE_KEY);
  return raw === "light" || raw === "dark" || raw === "system" ? raw : "system";
}

export function applyTheme(mode: ThemeMode) {
  if (typeof document === "undefined") return;
  const dark =
    mode === "dark" ||
    (mode === "system" &&
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
  document.documentElement.style.colorScheme = dark ? "dark" : "light";
}

type ThemeContextValue = {
  theme: ThemeMode;
  setTheme: (mode: ThemeMode) => void;
  /** Übernimmt den in der Kontoeinstellung gespeicherten Modus, ohne ihn erneut zu speichern. */
  syncTheme: (mode: ThemeMode) => void;
};

const ThemeContext = createContext<ThemeContextValue>({
  theme: "system",
  setTheme: () => {},
  syncTheme: () => {},
});

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemeMode>("system");

  useEffect(() => {
    const stored = readStoredTheme();
    setThemeState(stored);
    applyTheme(stored);
  }, []);

  useEffect(() => {
    if (theme !== "system" || typeof window === "undefined") return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => applyTheme("system");
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [theme]);

  const setTheme = useCallback((mode: ThemeMode) => {
    setThemeState(mode);
    applyTheme(mode);
    if (typeof window !== "undefined") window.localStorage.setItem(STORAGE_KEY, mode);
  }, []);

  const syncTheme = useCallback((mode: ThemeMode) => {
    setThemeState((current) => {
      if (current === mode) return current;
      applyTheme(mode);
      if (typeof window !== "undefined") window.localStorage.setItem(STORAGE_KEY, mode);
      return mode;
    });
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, setTheme, syncTheme }}>{children}</ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}

/** Inline-Skript: setzt die Klasse vor dem ersten Rendern, damit nichts aufblitzt. */
export const themeBootScript = `(function(){try{var m=localStorage.getItem("${STORAGE_KEY}")||"system";var d=m==="dark"||(m==="system"&&window.matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.classList.toggle("dark",d);document.documentElement.style.colorScheme=d?"dark":"light";}catch(e){}})();`;
