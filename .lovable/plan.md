# Nutzerverwaltung und Einstellungen

Ein neuer Bereich „Konto“ mit eigenem Profil, Team-Mitgliedern je Scope, Admin-Übersicht, App-Zugängen und persönlichen Einstellungen. Anmeldung bleibt vorerst E-Mail und Google; WorkOS-SSO kommt als späterer Schritt.

## Was entsteht

**1. Profil**
- Anzeigename, E-Mail, Avatar (Bild-Upload), Mitglied seit.
- Passwort ändern (mit Abfrage des aktuellen Passworts), Konto löschen mit Sicherheitsabfrage.

**2. Mitglieder je Scope**
- Liste aller Mitglieder eines Scopes mit Name, E-Mail, Rolle und Beitrittsdatum.
- Einladen per E-Mail, Rolle ändern (Inhaber, Bearbeiten, Lesen), entfernen.
- Nur Inhaber und Administratoren dürfen Rollen ändern; der letzte Inhaber kann nicht entfernt werden.
- Eingebunden im bestehenden Teilen-Dialog des Scopes und zusätzlich im Konto-Bereich als Übersicht aller Scopes.

**3. Admin-Bereich**
- Sichtbar nur für Administratoren: Liste aller Nutzer mit Name, E-Mail, Anzahl Scopes, letzter Aktivität.
- Rolle vergeben oder entziehen (Administrator), Konto sperren und entsperren.
- Gesperrte Konten kommen beim nächsten Seitenaufruf nicht mehr in die Anwendung.

**4. App-Zugänge**
- Übersicht aller veröffentlichten Apps mit Zugangsschlüssel, Rechten (nur Lesen / Lesen und Schreiben), Status und Datum.
- Schlüssel neu erzeugen, Zugang deaktivieren, Adresse kopieren.

**5. Einstellungen**
- Darstellung: helles/dunkles Erscheinungsbild, Raster und Hilfslinien standardmäßig an.
- Arbeiten: Start-Scope, automatisches Speichern, Beschriftungen an Verbindungen sichtbar.
- Benachrichtigungen: E-Mail bei Einladungen und bei fertigen Agenten-Ergebnissen.
- Sicherheit: Passwort ändern, aktive Anmeldung beenden, Konto löschen.
- Einstellungen gelten geräteübergreifend und wirken direkt im Scope-Editor.

## Aufbau der Oberfläche

```text
/konto
  Profil | Einstellungen | Mitglieder | App-Zugänge | Administration*
        (* nur für Administratoren sichtbar)
```
Erreichbar über ein Nutzermenü mit Avatar oben rechts auf der Startseite und im Scope; dort auch „Abmelden“.

## Datenschutz (DSGVO) und EU-Vorgaben

**6. Datenschutz-Bereich im Konto**
- Datenexport: alle eigenen Daten (Profil, Scopes, Module, Mitgliedschaften, Einstellungen) als Datei zum Herunterladen — Recht auf Datenübertragbarkeit.
- Konto löschen entfernt alle personenbezogenen Daten endgültig, mit klarer Vorschau, was gelöscht wird, und Wartezeit von 7 Tagen zum Widerruf.
- Einwilligungen: getrennte Schalter für optionale E-Mails und für KI-Auswertung von Inhalten, mit Datum der Zustimmung; Widerruf jederzeit möglich.
- Übersicht der Verarbeitungszwecke in einfacher Sprache und Verzeichnis der eingesetzten Dienste (Speicherung/Datenbank, KI-Auswertung, Karten, Wetterdaten) mit Angabe, welche Daten dorthin gehen.

**7. Transparenz und Protokolle**
- Protokoll sicherheitsrelevanter Vorgänge (Anmeldung, Rollenwechsel, Einladung, Löschung, Schlüsselerneuerung) mit Zeitpunkt und auslösender Person; für Betroffene einsehbar, für Administratoren vollständig.
- Datensparsamkeit: keine IP-Adressen oder Standortdaten im Protokoll, Aufbewahrung 90 Tage, danach automatische Löschung.
- KI-Kennzeichnung nach EU-Regeln für KI: Ergebnisse von Agenten, Entscheidungs- und Vision-Modulen werden sichtbar als maschinell erzeugt markiert, mit Hinweis auf menschliche Prüfpflicht; Entscheidungen bleiben Vorschläge.
- Statische Seiten Datenschutzerklärung, Impressum und Nutzungsbedingungen mit Verlinkung in Anmeldung, Konto und Fußzeile; Inhalte müssen von dir kommen (Firmenangaben, Verantwortlicher, Auftragsverarbeiter).

**8. Sicherheit und Barrierefreiheit**
- Löschung und Export laufen serverseitig geprüft, Rollen werden getrennt geführt, Zugriff strikt auf eigene Daten begrenzt.
- Bedienbarkeit nach EU-Barrierefreiheitsanforderungen: Tastaturbedienung, sichtbarer Fokus, ausreichende Kontraste, sinnvolle Beschriftungen in allen neuen Bereichen.

## Technische Umsetzung

- Migration: `profiles` um `avatar_url`, `settings` (jsonb), `blocked_at`, `updated_at` erweitern; neue Tabelle `user_roles` mit Enum `app_role` (`admin`, `user`) und Security-Definer-Funktion `has_role`; Tabelle `board_invites` (E-Mail, Scope, Rolle, Token, Status, Ablauf). GRANTs und RLS-Policies für jede Tabelle in derselben Migration; `board_members`-Policies um Rollenwechsel durch Inhaber/Admin ergänzen.
- Rollen niemals in `profiles` speichern — ausschließlich `user_roles` + `has_role()` in allen Policies.
- Server-Funktionen in `src/lib/account.functions.ts` und `admin.functions.ts` mit `requireSupabaseAuth`: Profil laden/speichern, Einstellungen speichern, Mitglieder listen/einladen/ändern/entfernen, Admin-Listen und Rollenvergabe (Rollencheck über `context.supabase.rpc('has_role')` vor `supabaseAdmin`-Nutzung im Handler), Konto löschen.
- Avatare in einem Storage-Bucket `avatars`, Lesen öffentlich, Schreiben nur eigener Pfad.
- Routen unter `src/routes/_authenticated/konto*.tsx`; Admin-Tab zusätzlich serverseitig geschützt.
- Neuer `useProfile`/`useSettings`-Hook über TanStack Query; Einstellungen werden im Scope-Editor für Raster, Hilfslinien und Kantenbeschriftungen gelesen.
- App-Zugänge nutzen die bestehende `apps`-Tabelle (`mcp_token`, `mcp_scope`, `is_public`); Schlüsselerneuerung als Server-Funktion.
- E-Mail-Benachrichtigungen: zunächst Einstellung speichern; Versand wird im Folgeschritt angebunden.

## Nicht in diesem Schritt

- WorkOS-SSO (folgt als SAML-Anbindung, wenn gewünscht).
- Tatsächlicher E-Mail-Versand für Einladungen und Agenten-Ergebnisse.
