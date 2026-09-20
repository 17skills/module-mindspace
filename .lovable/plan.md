# Inhalte mit dem Hintergrundfeld verknüpfen

Karten, die auf einem Hintergrundfeld (z. B. „Wertangebot“ im Business Model Canvas) liegen, werden inhaltlich diesem Feld zugeordnet. Die KI weiß dann: Dieser Apple-Text ist ein Beispiel für „Wertangebot“.

## Verhalten

**Automatische Zuordnung**
Wird eine Karte auf ein Hintergrundfeld gezogen und liegt ihr Mittelpunkt darin, ordnet das System sie diesem Feld zu. Liegt sie auf mehreren, gewinnt das kleinste Feld. Wird sie herausgezogen, löst sich die Zuordnung. Die Karte bleibt frei beweglich – sie wird nicht eingefangen oder gruppiert.

**Sichtbar auf der Karte**
Zugeordnete Karten zeigen unten eine kleine Kennzeichnung: Feldname plus Rolle, z. B. „Wertangebot · Beispiel“.

**Kontextfenster: neuer Reiter „Zuordnung“**
- Feld auswählen oder entfernen (Liste aller Hintergrundfelder des Boards)
- Rolle wählen: Beispiel, Beleg, Gegenbeispiel, Idee, Notiz
- Freitext „Warum gehört das hierher?“ (optional, fließt in den Kontext)
- Schalter „automatisch nach Lage“ (Standard an) – ausgeschaltet bleibt eine manuelle Zuordnung bestehen, auch wenn die Karte verschoben wird

**Wirkung in Chat und Auswertung**
Jeder Inhalt wird im Kontext mit seiner Feldzugehörigkeit übergeben, z. B.:
`[Wertangebot · Beispiel] Apple-Text — Begründung: zeigt Nutzenversprechen statt Produktmerkmale`
Der Chat kann so feldweise arbeiten („Fasse alle Beispiele zum Wertangebot zusammen“).

**Rechtsklick auf ein Hintergrundfeld** bekommt zusätzlich:
- „Chat zu diesem Feld“ – legt ein Chatmodul an, das alle Karten des Feldes als Kontext hat
- „Inhalte des Feldes zusammenfassen“ – erzeugt eine Notizkarte im Feld

## Technische Umsetzung

- Zuordnung in `nodes.metadata`: `{ zoneId, zoneRole, zoneNote, zoneAuto }`. Keine Migration nötig. Patches immer als `{ ...(record.metadata ?? {}), ... }`.
- Neue Helferdatei `src/lib/zones.ts`: `zoneAt(point, zones)` (Mittelpunkt-Treffer, kleinste Fläche gewinnt), `zoneLabel(record, records)`.
- `board.$boardId.tsx`: in `onNodeDragStop` für Nicht-Zonen/Nicht-Frame-Knoten mit `zoneAuto !== false` die Zone neu bestimmen und nur bei Änderung speichern. Beim Anlegen einer Karte gleiche Prüfung.
- `collectContext` und `sourcesFor` hängen den Präfix `[Feld · Rolle]` und die Begründung vor den Inhalt; Zonen selbst bleiben aus dem Kontext ausgeschlossen.
- Neuer Inspector-Reiter: `src/components/canvas/inspector/AssignTab.tsx`; `InspectorTab` um `"assign"` erweitern, Reiter für Inhalts- und Datenkarten sichtbar.
- `nodes.tsx`: Shell zeigt die Feld-Kennzeichnung (Farbe des Feldes als Punkt); `ZoneNode`-Kontextmenü um die zwei neuen Einträge erweitern.
- „Chat zu diesem Feld“ legt ein Chatmodul innerhalb des Feldes an und verbindet es nicht per Kante – der Kontext kommt aus der Feldzugehörigkeit; Feldzusammenfassung nutzt die bestehende Chat-Route mit `instructions`.
