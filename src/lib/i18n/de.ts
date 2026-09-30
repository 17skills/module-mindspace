/** Deutsche Oberflächentexte – Referenzsprache, alle anderen Sprachen folgen diesen Schlüsseln. */
export const de = {
  "lang.de": "Deutsch",
  "lang.en": "Englisch",
  "lang.system": "Wie der Browser",
  "theme.label": "Erscheinungsbild",
  "theme.light": "Hell",
  "theme.dark": "Dunkel",
  "theme.system": "Wie das Gerät",
  "language.label": "Sprache",
  "menu.account": "Konto-Menü",
  "menu.profile": "Profil",
  "menu.organisation": "Organisation",
  "menu.settings": "Einstellungen",
  "menu.privacy": "Datenschutz",
  "menu.signOut": "Abmelden",
  "nav.newScope": "Neuer Scope",
  "nav.scopes": "Scopes",
  "nav.apps": "Apps",
  "nav.more": "Mehr",
  "nav.search": "Suchen",
  "common.save": "Speichern",
  "common.cancel": "Abbrechen",
  "common.close": "Schließen",
  "common.saved": "Einstellungen gespeichert",
} as const;

export type TranslationKey = keyof typeof de;
