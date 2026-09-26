# Daten vom Scope trennen (Referenz statt Kopie)

## Ziel
Ein Scope hält keine Daten mehr, nur einen Verweis darauf. Tabellen, Dateien und API-Antworten liegen getrennt und geschützt. Die Karte zeigt nur Aufbau (Spalten), Größe und eine kleine Vorschau. Kein skalierbares Wissenssystem, keine Vektorsuche.

## Heute (geprüft)
- Tabellen werden in die Karte kopiert, gekappt bei 200 Zeilen. Der Rest geht verloren.
- Hochgeladene Dateien liegen schon im geschützten Speicher. Die Karte speichert davon nur den Pfad.

## Was gebaut wird
1. **Datenablage:** Jede aufgenommene Tabelle wird vollständig in einer eigenen, geschützten Ablage gespeichert. Sie hat eine Versionsnummer und eine Prüfsumme. Wer sie sehen darf, entscheiden die Rechte am Scope.
2. **Karte zeigt nur den Verweis:** Die Karte zeigt Spalten, Zeilenzahl, Qualität, Herkunft und die ersten 20 Zeilen als Vorschau. Die 200-Zeilen-Grenze entfällt.
3. **Geprüfte Quellen:** Eine Quelle kann „geprüft“ sein, z. B. ein amtliches Register oder eine feste API. Dann wird nichts kopiert: Gespeichert werden nur die Adresse und der Zeitpunkt des Abrufs. Das wird sichtbar als „geprüft“ markiert.
4. **Module lesen über den Verweis:** Karte, Regel-Prüfung, Sprachmodell und Ergebnis holen sich die Daten auf dem Server, und zwar gefiltert und begrenzt. Ein Durchlauf merkt sich, welche Version er benutzt hat. So bleibt nachvollziehbar, welche Daten zu welchem Ergebnis geführt haben.
5. **Bauplan-Datei:** Ein Export enthält nur Verweise und nie Daten. Beim Einspielen fehlen die Daten. Die Vorschau zeigt dann „Datenquelle neu verbinden“.
6. **Umzug:** Bestehende Tabellen-Karten werden beim ersten Öffnen einmal in die Ablage übernommen. Nichts geht verloren.
7. **Gäste:** Gäste sehen nur die Vorschau, und das nur bei freigegebenen Karten. Die ganze Tabelle bekommen sie nie.

## Nicht in diesem Schritt
Vektor- oder Graph-Suche, Zitatprüfer, parallele Prüf-Agenten, Vorlagen-Bibliothek (folgt als nächster Schritt).

## Prüfung
- Eine Tabelle mit 5.000 Zeilen hochladen: Die Karte bleibt klein, Filter und Karte arbeiten mit allen Zeilen.
- Ein Gast bekommt nie die ganze Tabelle.
- Export und Import enthalten keine Daten.
- Der Durchlauf nennt die Datenversion.
- Alle bisherigen Tests bleiben grün.

## Technische Details
- Migration: Tabelle `datasets` (id, board_id, node_id, version, checksum, schema jsonb, row_count, storage_path, origin_kind, verified bool, source_url, fetched_at, created_by) + GRANTs + RLS über bestehende Board-/Knotenrechte. Rohdaten als JSON-Lines/Parquet-freies JSONL im Bucket `uploads` unter `datasets/<board>/<id>/<version>.jsonl`.
- `SourceEnvelope` bekommt `facets.datasetRef { datasetId, version, checksum, rowCount, schema, preview }`; `trimEnvelope`/`STORED_ROWS` werden durch `toReference()` ersetzt.
- `datasets.functions.ts`: `storeDataset`, `queryDataset` (Filter, Spaltenauswahl, Limit ≤ 1000, requireSupabaseAuth), öffentliche Gast-Variante nur Vorschau.
- `runs`: Spalte `input_refs jsonb` (datasetId+version).
- `manifest.ts`: `sanitizeSettings` entfernt Zeilen, behält `datasetRef` ohne Inhalt; Import markiert fehlende Referenzen.
- Tests: Referenz-Rundlauf, Gast-Leak, Migration alter Karten, Manifest ohne Daten.
- AGENTS.md: Regel „Canvas hält nur Referenzen, Daten in `datasets`“.
