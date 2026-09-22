/** Persönliche Einstellungen eines Kontos – geräteübergreifend in `profiles.settings`. */
export type UserSettings = {
  theme: "light" | "dark" | "system";
  gridDefault: boolean;
  guidesDefault: boolean;
  startBoardId: string | null;
  autoSave: boolean;
  edgeLabels: boolean;
  notifyInvites: boolean;
  notifyAgents: boolean;
};

export const DEFAULT_SETTINGS: UserSettings = {
  theme: "system",
  gridDefault: true,
  guidesDefault: true,
  startBoardId: null,
  autoSave: true,
  edgeLabels: true,
  notifyInvites: true,
  notifyAgents: false,
};

export function settingsFrom(value: unknown): UserSettings {
  const raw = (value ?? {}) as Partial<UserSettings>;
  return {
    theme: raw.theme === "light" || raw.theme === "dark" ? raw.theme : DEFAULT_SETTINGS.theme,
    gridDefault: raw.gridDefault ?? DEFAULT_SETTINGS.gridDefault,
    guidesDefault: raw.guidesDefault ?? DEFAULT_SETTINGS.guidesDefault,
    startBoardId: typeof raw.startBoardId === "string" ? raw.startBoardId : null,
    autoSave: raw.autoSave ?? DEFAULT_SETTINGS.autoSave,
    edgeLabels: raw.edgeLabels ?? DEFAULT_SETTINGS.edgeLabels,
    notifyInvites: raw.notifyInvites ?? DEFAULT_SETTINGS.notifyInvites,
    notifyAgents: raw.notifyAgents ?? DEFAULT_SETTINGS.notifyAgents,
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
    service: "KI-Auswertung (Lovable AI Gateway)",
    data: "Von dir übergebene Texte und Fotos eines Moduls",
    purpose: "Analyse, Bewertung und Vorschläge – nur nach Einwilligung",
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
