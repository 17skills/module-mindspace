/** Persönliche Einstellungen eines Kontos – geräteübergreifend in `profiles.settings`. */
import type { AiProvider } from "@/lib/ai-providers";
import { defaultRouting, routingFrom, type AiRouting } from "@/lib/ai-functions";

/** Monatlicher Ausgabenhinweis je Anbieter in US-Dollar. */
export type AiBudgets = Partial<Record<"lovable" | AiProvider, number>>;

export type UserSettings = {
  theme: "light" | "dark" | "system";
  language: "de" | "en" | "system";
  gridDefault: boolean;
  guidesDefault: boolean;
  startBoardId: string | null;
  autoSave: boolean;
  edgeLabels: boolean;
  notifyInvites: boolean;
  notifyAgents: boolean;
  useByok: boolean;
  byokProvider: AiProvider;
  aiRouting: AiRouting;
  aiBudgets: AiBudgets;
  activeOrgId: string | null;
};

export const DEFAULT_SETTINGS: UserSettings = {
  theme: "system",
  language: "system",
  gridDefault: true,
  guidesDefault: true,
  startBoardId: null,
  autoSave: true,
  edgeLabels: true,
  notifyInvites: true,
  notifyAgents: false,
  useByok: false,
  byokProvider: "openai",
  aiRouting: defaultRouting(),
  aiBudgets: {},
  activeOrgId: null,
};

function budgetsFrom(value: unknown): AiBudgets {
  const raw = (value ?? {}) as Record<string, unknown>;
  const out: AiBudgets = {};
  for (const [key, amount] of Object.entries(raw)) {
    const num = Number(amount);
    if (Number.isFinite(num) && num > 0) out[key as keyof AiBudgets] = num;
  }
  return out;
}

export function settingsFrom(value: unknown): UserSettings {
  const raw = (value ?? {}) as Partial<UserSettings>;
  return {
    theme: raw.theme === "light" || raw.theme === "dark" ? raw.theme : DEFAULT_SETTINGS.theme,
    language: raw.language === "de" || raw.language === "en" ? raw.language : DEFAULT_SETTINGS.language,
    gridDefault: raw.gridDefault ?? DEFAULT_SETTINGS.gridDefault,
    guidesDefault: raw.guidesDefault ?? DEFAULT_SETTINGS.guidesDefault,
    startBoardId: typeof raw.startBoardId === "string" ? raw.startBoardId : null,
    autoSave: raw.autoSave ?? DEFAULT_SETTINGS.autoSave,
    edgeLabels: raw.edgeLabels ?? DEFAULT_SETTINGS.edgeLabels,
    notifyInvites: raw.notifyInvites ?? DEFAULT_SETTINGS.notifyInvites,
    notifyAgents: raw.notifyAgents ?? DEFAULT_SETTINGS.notifyAgents,
    useByok: raw.useByok ?? DEFAULT_SETTINGS.useByok,
    byokProvider: raw.byokProvider ?? DEFAULT_SETTINGS.byokProvider,
    aiRouting: routingFrom((raw as { aiRouting?: unknown }).aiRouting),
    aiBudgets: budgetsFrom((raw as { aiBudgets?: unknown }).aiBudgets),
    activeOrgId: typeof raw.activeOrgId === "string" ? raw.activeOrgId : null,
  };
}

/** Einwilligungen, die getrennt erteilt und jederzeit widerrufen werden können. */
export const CONSENT_PURPOSES = [
  {
    key: "ai_processing",
    title: "KI-Auswertung von Inhalten",
    text: "Fotos, Texte und Kennzahlen dürfen zur Analyse an das KI-Modell übergeben werden.",
  },
  {
    key: "marketing_email",
    title: "Optionale E-Mails",
    text: "Produktneuigkeiten und Hinweise zu neuen Funktionen per E-Mail.",
  },
] as const;

export type ConsentKey = (typeof CONSENT_PURPOSES)[number]["key"];

/** Verarbeitungszwecke und eingesetzte Dienste – Transparenz nach Art. 13/14 DSGVO. */
export const PROCESSING_PURPOSES = [
  {
    service: "Speicherung & Datenbank (Lovable Cloud, EU)",
    data: "Konto, Scopes, Module, Befunde, Einstellungen",
    purpose: "Betrieb der Anwendung und Speicherung deiner Arbeitsergebnisse",
  },
  {
    service: "KI-Auswertung (Lovable AI Gateway oder dein eigener KI-Anbieter)",
    data: "Von dir übergebene Texte und Fotos eines Moduls",
    purpose:
      "Analyse, Bewertung und Vorschläge – nur nach Einwilligung. Mit eigenem Schlüssel (BYOK) gehen die Daten an dein eigenes Anbieterkonto, sonst an das Lovable AI Gateway.",
  },
  {
    service: "Kartendienst",
    data: "Koordinaten der angezeigten Objekte",
    purpose: "Darstellung von Standorten auf der Karte",
  },
  {
    service: "Wetterdaten",
    data: "Koordinaten eines Standorts",
    purpose: "Wetterlage und Warnhinweise für Inspektionen",
  },
] as const;
