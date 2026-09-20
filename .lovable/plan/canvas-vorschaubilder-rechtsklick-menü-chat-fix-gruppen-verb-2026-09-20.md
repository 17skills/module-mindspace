# Canvas: Vorschaubilder, Rechtsklick-Menü, Chat-Fix, Gruppen-Verbindungen

Vier Korrekturen an der bestehenden Arbeitsfläche.

## 1. Chat reparieren (Ursache bestätigt)

Der Chat gibt aktuell eine leere Antwort zurück. Im Serverprotokoll steht bei jeder Anfrage
`Invalid prompt: System messages are not allowed in the prompt or messages fields. Use the instructions option instead.`
Die Anweisung und die verbundenen Inhalte werden also so übergeben, wie es die aktuelle KI-Bibliothek nicht mehr erlaubt – der Fehler entsteht erst während des Streams und wird stillschweigend als leere Antwort ausgeliefert.

- Anweisung und Inhalte als `instructions` übergeben statt als Systemnachrichten.
- Fehler im Stream nicht mehr verschlucken: fehlschlagende Anfragen liefern eine sichtbare Fehlermeldung im Chat-Modul statt einer leeren Blase.
- Gegenprobe mit allen drei Modellen direkt gegen die Route.

## 2. Immer ein Vorschaubild

Jede Inhaltskarte bekommt oben eine Vorschau, damit man sie auf einen Blick erkennt:

- YouTube: Videobild (wird bereits geholt).
- Podcast/Audio: Coverbild aus dem Feed bzw. den Datei-Metadaten; sonst eine typgefärbte Kachel mit Symbol.
- Link: Vorschaubild der Seite (og:image) – wird beim Einlesen mit ausgelesen.
- PDF/PPTX: erste Seite bzw. erste Folie als Bild gerendert und im Dateispeicher abgelegt.
- Notiz/Chat: farbige Kachel mit Symbol und erstem Textauszug.

Fällt alles aus, zeigt die Karte eine einheitliche Platzhalter-Kachel in der Typfarbe – nie mehr „nackter Text“.

## 3. Inhalte direkt auf dem Canvas hinzufügen

- Rechtsklick auf die freie Fläche öffnet ein Kontextmenü an der Mausposition: Link einfügen, Datei hochladen, Notiz, Chat-Modul, Gruppe.
- Neue Elemente entstehen genau dort, wo geklickt wurde.
- Rechtsklick auf eine Karte: Notiz duplizieren/löschen, zu Gruppe hinzufügen, verbinden.
- Einfügen per Tastatur (Strg+V) und Drag-and-drop von Dateien bleiben erhalten.
- Die Buttonleiste oben wird auf Boardtitel und Zurück-Link reduziert.

## 4. Verbindungen über die Gruppe

- Karten innerhalb einer Gruppe bekommen keine eigenen Verbindungspunkte mehr; verbunden wird die Gruppe als Ganzes.
- Eine Verbindung zur Gruppe liefert dem Chat automatisch die Inhalte aller enthaltenen Karten (funktioniert bereits, wird auf die neue Regel abgestimmt).
- Beim Gruppieren werden bestehende Verbindungen der einzelnen Karten auf die Gruppe umgehängt; beim Auflösen bleiben sie an der Gruppe und werden entfernt.
- Bestehende Warnung „Parent node not found“ verschwindet, indem Gruppen vor ihren Karten in die Fläche geschrieben werden.

## 5. Strukturierte Daten als eigene Module herauslösen

Aus jedem Inhalt lassen sich Tabellen, Listen und Diagramme als eigenständige Karten herausziehen:

- Kontextmenü auf einer Inhaltskarte: „Strukturierte Daten herauslösen“. Die KI erkennt im Text enthaltene Tabellen, Aufzählungen und Zahlenreihen.
- Ergebnis: pro gefundener Struktur eine neue Karte – Tabelle (sortier- und editierbar), Liste (Punkte einzeln bearbeitbar), Diagramm (Balken, Linie, Kreis; Typ umschaltbar).
- Die neuen Karten werden automatisch mit der Quellkarte verbunden, damit die Herkunft sichtbar bleibt.
- Diese Karten sind vollwertige Module: mit anderen Inhalten oder dem Chat verbindbar; ihre Daten gehen als strukturierter Text in den Chat-Kontext ein.
- Umgekehrt kann der Chat neue Tabellen/Diagramme erzeugen („Vergleiche die Videos in einer Tabelle“) und direkt als Karte ablegen.

## Technische Hinweise

- `src/routes/api/chat.ts`: `instructions`-Option statt System-`ModelMessage`; `onError` protokollieren und Fehlertext in den Stream schreiben.
- Vorschau: `metadata.thumbnail` als einheitliches Feld; og:image-Auslese in `fetchPageText`/`resolvePodcast`; PDF-Seitenrendering über die vorhandene PDF-Bibliothek clientseitig, PPTX-Folienbild aus dem eingebetteten Vorschaubild der Datei; Upload in den vorhandenen `uploads`-Bucket.
- Kontextmenü als eigene Komponente über `onPaneContextMenu`/`onNodeContextMenu` von React Flow, Position über `screenToFlowPosition`.
- Verbindungslogik: Handles bei Karten mit `parent_id` deaktivieren, Kanten beim Gruppieren auf die Frame-ID umschreiben (Duplikate zusammenführen).
- Strukturierte Daten: Extraktion per Server-Funktion mit einfacher, strikter Struktur (Titel, Typ, Spalten, Zeilen) über `openai/gpt-6-astra`; neue Kartentypen `table`, `list`, `chart` mit Daten in `metadata`; Diagramme mit Recharts.
