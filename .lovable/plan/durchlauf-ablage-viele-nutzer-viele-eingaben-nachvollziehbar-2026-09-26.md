# Durchlauf-Ablage: viele Nutzer, viele Eingaben, nachvollziehbare Ergebnisse

## Ziel
Wenn viele Nutzer über eine App Fotos oder andere Eingaben schicken, überschreiben sie sich nicht mehr auf dem Canvas. Jeder Durchlauf wird einzeln abgelegt: wer, wann, welche Datei, welches Modell, welches Ergebnis. Der Canvas bleibt die Werkbank und zeigt nur die Zusammenfassung.

## Was der Nutzer sieht
- **Am Ergebnis-Modul (Canvas):** kleine Zeile „12 Durchläufe · letzter vor 3 Min." und ein Knopf „Durchläufe ansehen".
- **Durchlauf-Liste / Galerie:** Umschalter Liste/Galerie, Filter nach Status (läuft, fertig, fehlgeschlagen) und Zeitraum. Jeder Eintrag öffnet eine Detailansicht mit Eingabe, Ergebnis und Nachweis (Person, Zeit, Datei-Prüfsumme, Modell/Motor, Regelstand).
- **In der App:** Endnutzer sehen nur ihre eigenen Durchläufe; Verwalter sehen alle.
- **Löschfristen:** in den Scope-Einstellungen wählbar (7 / 30 / 90 Tage, Standard 30). Eingabedateien werden danach gelöscht, der Nachweis bleibt ohne Personenbezug bestehen.
- **Protokoll:** jede Aktion (angelegt, fertig, angesehen durch Verwalter, gelöscht) wird unveränderlich festgehalten und ist als Liste einsehbar.

## Ehrliche Grenzen
- Das Protokoll ist gegen Änderungen durch die App gesperrt; eine rechtliche Konformitätsbewertung (DSGVO/EU AI Act) ersetzt es nicht.
- Der eigentliche mobile Eingang (Foto rein → Agent) folgt als eigener Schritt; hier entsteht die Ablage, die er benutzt. Zum Testen gibt es einen „Testdurchlauf"-Knopf am Ergebnis-Modul.

## Technische Details
- Neue Tabellen: `runs` (board_id, output_node_id, app_id, user_id, status, input_path, input_sha256, engine, provider, model, context_checksum, result jsonb, error, created_at, finished_at, expires_at) und `run_events` (run_id, actor_id, action, detail, created_at) — `run_events` nur einfügen, Update/Delete per Trigger blockiert.
- RLS: Nutzer lesen eigene Runs; Scope-Inhaber/Bearbeiter und App-Verwalter lesen alle Runs ihres Scopes. Schreiben nur über Server-Funktionen (`src/lib/runs.functions.ts`, requireSupabaseAuth + Rollenprüfung + Drosselung).
- Dateien im privaten Bucket `uploads` unter `runs/<board>/<run>/`, Prüfsumme serverseitig; Anzeige nur per kurz signierter Adresse.
- Aufbewahrung: Scope-Einstellung `metadata.retentionDays`; täglicher Cron-Endpunkt `/api/public/runs-purge` (mit Cron-Geheimnis) löscht abgelaufene Dateien, anonymisiert `user_id`, protokolliert „purged".
- Gastansicht: Runs werden über Gastlinks nie ausgeliefert (Regressionstest ergänzen).
- Canvas lädt nur Zählwert und letzten Zeitstempel (keine Liste), damit das Tempo nicht leidet; Liste seitenweise (50).
- Tests: Rechte (eigene vs. fremde Runs), Unveränderlichkeit des Protokolls, Löschfrist-Berechnung, Gast sieht keine Runs.
