# Grundarchitektur: Scope-Manifest (YAML + Markdown)

## Ziel
Ein Scope lässt sich vollständig als eine lesbare Datei beschreiben. Quellen, Motoren (Agent, Modell, API, MCP) und Ergebnisse sind austauschbar. Aus demselben Scope entstehen beliebig viele Apps – jede ist nur eine Auswahl von Modulen und läuft als Web-App, mobile Web-App, Teams-App oder MCP-App. Die Datei kann exportiert, importiert, von Bots (Grok, Hermes, Claude) geschrieben und später auf einem Marktplatz getauscht werden.

```text
Scope-Manifest (YAML, optional + Markdown für Aufträge/Texte)
  sources  ──▶  steps (Motoren)  ──▶  outputs  ──▶  actions (Ablagefach)
  apps: [ { module-Auswahl, Kanal: web | mobile | teams | mcp } ]
        │            │              │
     Canvas       Runner         Kanäle
   (Editor)   (führt aus)   (zeigen / liefern)
```

## Was gebaut wird (in dieser Reihenfolge)

### 1. Manifest-Format (Vertrag)
- Version, Scope-Titel, optional Regelwerk.
- `modules`: jedes Modul mit `id`, `role` (source | step | output | action), `type`, Titel, Einstellungen, Position.
- Motoren als austauschbarer Eintrag: `engine: { kind: model | api | mcp | agent, ref, params }` – der Prozess bleibt gleich, nur `engine` ändert sich.
- `links`: Verbindungen `von.ausgang → nach.eingang` mit Datenart (dataset, document, image, video, model3d, slides, text, any).
- `apps`: Titel, Kanal, Modul-IDs, Branding, Zugriff (public/org/restricted).
- Markdown-Teil: lange Aufträge und Texte je Modul per Verweis (`task: "#auftrag-3d"`), damit YAML schlank bleibt.
- Keine Geheimnisse in der Datei: Zugangsschlüssel nur als Name eines hinterlegten Schlüssels.

### 2. Übersetzer Canvas ⇄ Manifest
- Export: Scope → YAML (+ MD) als Download oder Kopie.
- Import: YAML/MD auf den Canvas ziehen oder einfügen → Vorschau („12 Module, 2 Apps, 1 fehlender Schlüssel") → Übernehmen legt Module, Kabel und Apps an.
- Import läuft über die bestehende Quellen-Aufnahme: eine Manifest-Datei wird erkannt und statt als Quelle als Bauplan angeboten.
- Prüfung beim Import: unbekannte Modulart, fehlende Verbindungspartner, unpassende Datenarten → Klartext-Hinweis, nie Abbruch.

### 3. Ergebnis-Modul
- Neuer Modultyp „Ergebnis" mit Eingang und fester Darstellungsart: Bild, Video, Text/Bericht, Folien (Vorschau + Download), 3D (drehbare Ansicht).
- Gleiche Darstellung auf dem Canvas und in allen App-Kanälen.

### 4. Motor-Schritt am Feld
- Hintergrundfeld bekommt einen Motor-Umschalter: Modell (Lovable AI / eigener Schlüssel), API, MCP-Werkzeug.
- Bestehende API- und MCP-Module werden als Motoren nutzbar; Ergebnis fließt per Kabel ins Ergebnis-Modul.
- Erster echter Pfad: Foto/PDF → Modell-Schritt → Ergebnis (Bild bzw. Bericht). Video/3D-Motoren folgen, sobald ein Anbieter-Schlüssel hinterlegt ist.

### 5. Runner
- Ein gemeinsamer Ablauf führt die Schritte einer App entlang der Kabel aus – egal ob ausgelöst vom Canvas, von der mobilen App, aus Teams oder per MCP-Aufruf.
- Langsame Schritte laufen im Hintergrund; die App zeigt Status („wird berechnet") und dann das Ergebnis.
- Wirkungen nach außen landen weiter nur im Ablagefach (Freigabe durch Menschen).

### 6. Apps als Auswahl + Kanal
- App-Art wird um den Kanal erweitert: web, mobile, teams, mcp (bestehende Arten „Erfassung"/„Cockpit" werden zu Vorlagen).
- Obergrenze von 5 Modulen je App wird überprüft und ggf. angehoben.
- App 1 (Eingabe) und App 2 (Verarbeitung + Ergebnis) aus demselben Scope funktionieren über gemeinsame Module.
- MCP-App: Eingänge der Auswahl werden zu Werkzeug-Parametern, Ergebnis-Module zur Antwort.

## Nicht in diesem Schritt
Marktplatz selbst (nur das austauschbare Format), Video- und 3D-Anbieter ohne Schlüssel, Übersetzung von Nutzerfragen.

## Prüfung
Ein Scope wird exportiert, gelöscht, wieder importiert und ist gleich. Ein von Hand geschriebenes YAML baut einen Scope mit zwei Apps; die mobile App nimmt ein Foto auf, die zweite App zeigt das Ergebnis; derselbe Ablauf ist als MCP-Werkzeug aufrufbar. Motor-Tausch ändert nichts an Apps und Kabeln.

## Technische Details
- Neu: `src/lib/runtime/manifest.ts` (zod-Schema, Version `scopebuilder/v1`), `manifest-io.ts` (Scope→YAML/MD, YAML/MD→Plan, Diff-Vorschau), Tests mit Rundlauf.
- YAML-Parser aus der vorhandenen Aufnahme (`entity-adapter`) wiederverwenden; Sniffer erkennt `scopebuilder:`-Kopf.
- `units.ts`: neue Units `output.*` und `step.engine`; Links nutzen `portsCompatible` aus dem Signal-Bus.
- Migration: `apps.channel` (web|mobile|teams|mcp), `apps.manifest_version`; Tabelle `runs` (app_id, step, status, input_checksum, output_ref, error) mit GRANTs + RLS über bestehende Knoten-Rechte.
- Runner als Server-Funktion; Ergebnisse (Bilder, PDFs, PPTX) im bestehenden Speicher-Bucket, im Modul nur der Verweis.
- `AppEngine` rendert `output`-Module; MCP-Endpunkt je App (`app.$appId.mcp`) leitet Werkzeuge aus Eingängen/Ergebnissen der Auswahl ab.
- Entscheidung in `AGENTS.md` festhalten: Manifest ist die einzige Wahrheit für Export/Import; Canvas und Kanäle sind Projektionen.
