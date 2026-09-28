# Zeitlimit je Baustein und Datenschutz-Filter vor KI-Aufrufen

Die zwei offenen Punkte, die vor Enterprise-Einsatz noch fehlen. Kein Marktplatz, keine YouTube-Suche.

## 1. Zeitlimit je Baustein erzwingen
- Jeder Baustein hat ein Zeitlimit (Standard aus dem Katalog, sonst ein fester Standarddeckel, nie unbegrenzt).
- Läuft ein Schritt länger, bricht der Server ihn hart ab. Der Ablauf geht nicht stillschweigend weiter: der Schritt steht auf „Zeitlimit überschritten“, folgende Schritte laufen nicht.
- Gilt überall gleich: KI-Chat, KI-Schritte, API-Abrufe, MCP-Werkzeuge, App-Durchläufe und Start durch andere Systeme.
- Der Abbruch wird mit Grund und Dauer im Durchlauf-Protokoll festgehalten; das Ergebnis-Modul zeigt einen Klartext-Hinweis.
- Ein Durchlauf als Ganzes hat zusätzlich eine Obergrenze (Summe, gedeckelt), damit viele kurze Schritte nicht endlos laufen.

## 2. Datenschutz-Filter vor KI-Aufrufen
- Bevor Text an ein KI-Modell geht, werden persönliche Daten erkannt und ersetzt: E-Mail-Adressen, Telefonnummern, IBAN, Kreditkartennummern, Steuer-/Ausweisnummern, IP-Adressen, erkennbare Zugangsschlüssel.
- Ersetzt wird durch Platzhalter wie `[EMAIL_1]`; gleiche Werte bekommen denselben Platzhalter, damit die Antwort verständlich bleibt. Platzhalter werden in der Antwort nicht zurückgetauscht (Daten verlassen den Server nie).
- Schalter je Scope: „Streng“ (Standard, alles maskieren), „Nur Schlüssel“ (nur Geheimnisse), „Aus“ (nur Inhaber/Admin, wird protokolliert). Ein Baustein kann den Schutz nur verschärfen.
- Protokoll: Anzahl und Art der Ersetzungen pro Aufruf, nie die Werte selbst.
- Ehrliche Grenze: Namen und Adressen in Fließtext werden nicht zuverlässig erkannt (Mustererkennung, kein KI-Vorfilter). Das steht so auch auf der Datenschutzseite.

## Prüfung
- Tests: Zeitlimit bricht einen künstlich langsamen Schritt ab; Maskierung für alle Datenarten, gleiche Werte gleicher Platzhalter, keine Rückübersetzung.
- Browser: KI-Chat mit E-Mail und IBAN – beim Modell kommen nur Platzhalter an; Start durch anderes System mit zu kurzem Zeitlimit liefert „Zeitlimit überschritten“ und Protokolleintrag.

## Technische Details
- `src/lib/budget.ts`: `readBudget` liefert zusätzlich `timeoutSeconds` (Engine-Governance bzw. `settings.timeoutSeconds`, geclampt, Standard 45 s, Durchlauf-Obergrenze 300 s). Helfer `withTimeout(promise, ms, signal)` auf Basis `AbortController`; `abortSignal` an `streamText`/`generateText`, `fetch` in `api-fetch.server.ts` und MCP-Client weiterreichen.
- `flow-run.server.ts`: jeder Schritt in `withTimeout`; Status `timeout`, Eintrag in `run_events` (`action: "timeout"`, Dauer); Gesamtbudget über alle Schritte.
- Neu `src/lib/pii.ts`: `redactPii(text, mode)` → `{ text, counts }`; reine Regex-Detektoren mit Prüfziffern (IBAN mod 97, Luhn), stabile Platzhalter-Map pro Aufruf. Einbindung zentral in `wrapUntrusted`-Nähe bzw. im KI-Aufrufpfad (`/api/chat`, Agent-, Faktor-, API-Modul-Auswertung) vor Modellübergabe.
- Modus in `boards.rules.privacy` (bestehende Spalte, kein Schema-Umbau); `ai_usage` bekommt keine Werte, Zähler gehen in `run_events.detail` bzw. Server-Log.
- AGENTS.md: Regel „Jeder Modellaufruf läuft durch `redactPii` und `withTimeout`“; roadmap.md abhaken.
