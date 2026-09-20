# Kontextfenster rechts im Canvas

## Designvorgabe (openinstitute-Designsystem)

Das Kontextfenster und danach schrittweise die übrige Oberfläche folgen dem verlinkten Figma-Designsystem (Farben, Typografie, Abstände, Ecken, Schatten, Formularelemente). Umgesetzt wird das über die zentralen Design-Tokens, nicht über Einzelfarben in Bausteinen.

Damit ich das Designsystem direkt auslesen kann, brauche ich einen der beiden Wege:
- Lovable Desktop installieren (https://lovable.dev/download), in Figma Desktop den Dev-Modus öffnen (Shift+D), dort "Enable desktop MCP server" aktivieren und die Verbindung in Lovable unter Einstellungen -> Connectors -> Local MCP servers herstellen. Danach lese ich Farben und Schriften direkt aus der Datei.
- Oder du schickst mir Screenshots der Farb-, Schrift- und Komponentenseiten; dann übertrage ich die Werte von Hand.

Bis einer der Wege steht, baue ich das Kontextfenster funktional fertig im bestehenden Stil und ziehe das Design anschließend nach.

Statt eines Dialogs bekommt die Arbeitsfläche ein festes Seitenfenster rechts. Es ist der Ort, an dem man Inhalte anschaut, Ausschnitte auswählt und daraus Tabellen, Listen und Diagramme erzeugt oder bestehende aktualisiert.

## Verhalten

- Rechtsklick auf eine Karte -> "Im Kontextfenster öffnen"; ein einfacher Klick auf "Daten herauslösen" oder "Bearbeiten" öffnet es ebenfalls.
- Das Fenster liegt rechts neben der Fläche (etwa 380-520 px, per Ziehen breiter/schmaler, schließbar). Die Fläche bleibt daneben bedienbar.
- Oben: Titel des Moduls, Typ, Schließen. Darunter Reiter: **Quelle**, **Daten**, **Aktualisieren**.
- Auf schmalen Bildschirmen (Handy/Tablet) erscheint es als eingeblendete Ebene über der Fläche.

## Reiter "Quelle" - Inhalt ansehen und auswählen

Je nach Modultyp:

- **PDF**: Seiten untereinander scrollbar, jede Seite als Bild mit Seitenzahl und Auswahlhaken. Kopfzeile: "Alle", "Keine", "Seiten 3-7" per Eingabe.
- **PPTX/DOCX/TXT/MD**: Inhalt in Abschnitten (Folien bzw. Absatzblöcke), jeder Abschnitt einzeln auswählbar.
- **YouTube**: eingebetteter Player oben, darunter das Transkript in Zeitabschnitten; Klick auf einen Abschnitt springt im Video dorthin, Haken wählt ihn aus.
- **Podcast/Audio**: Audio-Player mit demselben Transkript-Prinzip.
- **Link**: Textabschnitte der Seite, auswählbar; Vorschaubild oben.
- **Notiz / Tabelle / Liste / Diagramm**: reiner Textausschnitt bzw. Datenansicht.

Unten steht immer, wie viel ausgewählt ist ("7 von 24 Seiten, ca. 12.000 Zeichen"). Nur die Auswahl geht in die KI-Analyse.

## Reiter "Daten" - Bearbeiten

Für Tabellen-, Listen- und Diagramm-Module:

- Titel ändern.
- Tabelle: Zellen bearbeiten, Zeilen und Spalten hinzufügen, löschen, umbenennen, Zeilen verschieben.
- Liste: Punkte bearbeiten, hinzufügen, löschen, sortieren.
- Diagramm: dieselbe Datentabelle plus Umschalter Balken/Linie/Kreis und Auswahl, welche Spalte Beschriftung und welche Wert ist.
- Typ umschalten (Tabelle <-> Liste <-> Diagramm) ohne Datenverlust.
- Änderungen werden sofort gespeichert und auf der Karte sichtbar.

## Reiter "Aktualisieren" - neu aus Quellen ziehen

- Liste der Quellen: die verbundene Quellkarte plus alle weiteren Module des Boards zum Ankreuzen.
- Freitextfeld: was genau herausgelöst werden soll ("nur die Tabelle mit den Kommunenzahlen", "Umsatz je Quartal").
- Zwei Schaltflächen: **Daten ersetzen** (vorhandene Karte überschreiben) und **Als neues Modul** (neue Karte, automatisch mit den Quellen verbunden).
- Vor dem Übernehmen eine Vorschau der erkannten Struktur mit "Übernehmen" / "Verwerfen"; laufende Analyse wird mit Statuszeile angezeigt.
- Wenn nichts Passendes gefunden wird, erscheint eine klare Meldung statt einer leeren Tabelle.

## Vorbereitet für später

Das Fenster bekommt eine Struktur, in der später weitere Inhalte auftauchen: YouTube-Suche mit Trefferliste zum Aufs-Board-Ziehen und Verwaltung/Konfiguration eingebundener MCP-Verbindungen. In diesem Schritt werden nur die drei Reiter oben gebaut.

## Technische Umsetzung

- Neue Komponenten unter `src/components/canvas/inspector/`: `InspectorPanel.tsx` (Rahmen, Reiter, Breite per Ziehen), `SourceTab.tsx`, `DataTab.tsx`, `RefreshTab.tsx`. Zustand (offenes Modul, Auswahl) im Board-Route-State, per `BoardContext` erweitert um `openInspector(nodeId, tab)` und `refreshStructure(...)`.
- Layout in `src/routes/board.$boardId.tsx`: Flex-Container, ReactFlow links, Panel rechts.
- Abschnittsdaten: beim Einlesen zusätzlich `metadata.segments` speichern - PDF: `{ page, text, thumb }` (Seitenbilder über `unpdf`-Rendering wie in `src/lib/preview.ts`, als JPEG-Data-URLs, gedeckelt auf die ersten ~40 Seiten), PPTX: pro Folie, Text/MD: Absatzblöcke à ~1.500 Zeichen, YouTube/Audio: Transkriptabschnitte mit Startzeit aus den Caption-Zeitstempeln bzw. `verbose_json`-Segmenten der Transkription. Bestehende Module ohne `segments` werden beim Öffnen des Fensters einmalig nachträglich zerlegt (Text-Splitting; PDF-Bilder nur, wenn die Datei im Bucket liegt).
- `extractStructured` in `src/lib/ingest.functions.ts` bekommt zusätzliche Eingaben `instruction` und `targetKind` und wird für "Daten ersetzen" mit dem ausgewählten Textausschnitt aufgerufen; Modell bleibt `openai/gpt-6-astra` mit striktem JSON-Schema.
- Kartendaten bleiben in `nodes.metadata` (`columns`, `rows`, `chartType`) plus gespiegeltem Text in `content` für den Chat-Kontext; `DataNode` wird auf reine Anzeige plus "Bearbeiten"-Knopf reduziert.
