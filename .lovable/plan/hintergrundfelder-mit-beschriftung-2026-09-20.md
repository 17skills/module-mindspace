# Hintergrundfelder mit Beschriftung

Neue Elemente, die rein der Orientierung dienen: farbige Flächen mit Titel, die hinter allen Karten liegen – wie die Felder eines Business Model Canvas.

## Was du bekommst

- Rechtsklick auf die freie Fläche → „Hintergrundfeld“ legt ein beschriftetes Rechteck an der Mausposition an.
- Titel oben links im Feld, per Doppelklick umbenennbar.
- Feld frei verschiebbar und in der Größe änderbar; liegt immer hinter den Inhaltskarten.
- Karten, die darüber liegen, werden nicht eingefangen: ein Hintergrundfeld gruppiert nichts, verbindet nichts, fließt nicht in den Chat-Kontext und hat keine Verbindungspunkte.
- Farbauswahl (wenige ruhige Töne aus dem Farbsystem) über das Rechtsklick-Menü des Feldes.
- Löschen über das Rechtsklick-Menü; ein Klick auf die Fläche des Feldes wählt es nur aus, blockiert aber nicht das Verschieben der Karten darüber.
- Zusätzlich im Rechtsklick-Menü der Fläche: „Vorlage: Business Model Canvas“ legt die neun benannten Felder in der klassischen Anordnung auf einmal an.

## Technische Umsetzung

- Neuer Knotentyp `zone` in `nodes` (Titel, Position, Größe, `color`); keine Kanten, kein `parent_id`-Verhalten.
- `ZoneNode` in `src/components/canvas/nodes.tsx`: nur Rahmen, Hintergrundfläche mit niedriger Deckkraft, Titel-Input, `NodeResizer`, keine `Handle`s.
- In `board.$boardId.tsx`: `zone` in `nodeTypes` registrieren; `sortNodes` sortiert Zonen ganz an den Anfang; `zIndex: -1`, `selectable: true`, `draggable: true`, `connectable: false`, `extent` unverändert.
- Ausschluss aus `collectContext`, `sourcesFor`, `groupSelection` und der Kanten-Umhängelogik (Zonen sind nie Gruppeneltern).
- Vorlage als Konstanten-Array (Titel + Position + Größe) im Board-Modul, ein Batch-Insert.
- Keine Migration nötig: `type` ist ein Textfeld, `color` und Größen existieren bereits.
