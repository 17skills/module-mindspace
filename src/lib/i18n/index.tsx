/**
 * Schlankes Sprachsystem: Wörterbuch je Sprache, Auswahl lokal gespeichert,
 * Kontoeinstellung spiegelt die Wahl geräteübergreifend.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { de, type TranslationKey } from "./de";
import { en, englishUi } from "./en";

export type Language = "de" | "en" | "system";
export type ResolvedLanguage = "de" | "en";

const STORAGE_KEY = "scopebuilder.language";
const DICTIONARIES: Record<ResolvedLanguage, Record<TranslationKey, string>> = { de, en };

export const LANGUAGE_OPTIONS: { value: Language; key: TranslationKey }[] = [
  { value: "system", key: "lang.system" },
  { value: "de", key: "lang.de" },
  { value: "en", key: "lang.en" },
];

export function readStoredLanguage(): Language {
  if (typeof window === "undefined") return "system";
  const raw = window.localStorage.getItem(STORAGE_KEY);
  return raw === "de" || raw === "en" || raw === "system" ? raw : "system";
}

export function resolveLanguage(value: Language): ResolvedLanguage {
  if (value === "de" || value === "en") return value;
  if (typeof navigator === "undefined") return "de";
  return navigator.language.toLowerCase().startsWith("en") ? "en" : "de";
}

type I18nContextValue = {
  language: Language;
  resolved: ResolvedLanguage;
  setLanguage: (value: Language) => void;
  /** Übernimmt die Kontoeinstellung, ohne sie erneut zu speichern. */
  syncLanguage: (value: Language) => void;
  t: (key: TranslationKey) => string;
  l: (german: string) => string;
  locale: string;
};

const I18nContext = createContext<I18nContextValue>({
  language: "de",
  resolved: "de",
  setLanguage: () => {},
  syncLanguage: () => {},
  t: (key) => de[key],
  l: (german) => german,
  locale: "de-DE",
});

export function I18nProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>("de");
  const resolved = useMemo(() => resolveLanguage(language), [language]);

  useEffect(() => {
    setLanguageState(readStoredLanguage());
  }, []);

  useEffect(() => {
    if (typeof document !== "undefined") document.documentElement.lang = resolved;
  }, [resolved]);

  const setLanguage = useCallback((value: Language) => {
    setLanguageState(value);
    if (typeof window !== "undefined") window.localStorage.setItem(STORAGE_KEY, value);
  }, []);

  const syncLanguage = useCallback((value: Language) => {
    setLanguageState((current) => {
      if (current === value) return current;
      if (typeof window !== "undefined") window.localStorage.setItem(STORAGE_KEY, value);
      return value;
    });
  }, []);

  const t = useCallback((key: TranslationKey) => DICTIONARIES[resolved][key] ?? de[key], [resolved]);
  const l = useCallback((german: string) => resolved === "en" ? (englishUi[german] ?? german) : german, [resolved]);
  const locale = resolved === "en" ? "en-GB" : "de-DE";

  return (
    <I18nContext.Provider value={{ language, resolved, setLanguage, syncLanguage, t, l, locale }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useTranslation() {
  return useContext(I18nContext);
}

export type { TranslationKey };
