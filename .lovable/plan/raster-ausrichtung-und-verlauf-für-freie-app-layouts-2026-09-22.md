# Raster, Ausrichtung und Verlauf für freie App-Layouts

## Ziel
Die freie App-Fläche erhält präzise, zuschaltbare Layout-Hilfen. Änderungen an Position, Größe und Anordnung können direkt rückgängig gemacht und wiederhergestellt werden.

## Umsetzung
- In der Desktop-Vorschau der „Freien Fläche“ eine kompakte Werkzeugleiste ergänzen: Raster anzeigen, magnetisches Einrasten aktivieren, Rückgängig, Wiederherstellen und Ausrichten.
- Ein Modul wird durch Anklicken oder über seinen Ziehgriff ausgewählt und klar hervorgehoben.
- Beim Verschieben und Skalieren zeigen temporäre Hilfslinien passende Kanten und Mittellinien anderer Module an.
- Magnetisches Einrasten richtet das aktive Modul beim Ablegen an nahen Kanten, Mittelpunkten und dem Raster aus; ohne Magnet bleibt das Verschieben frei innerhalb des feineren internen Rasters.
- Ausrichtungsbefehle für links, horizontal mittig, rechts, oben, vertikal mittig und unten ergänzen. Mehrere Module können ausgewählt werden; die Ausrichtung bleibt kollisions- und flächengeprüft.
- Jede bestätigte Verschiebung, Größenänderung und Ausrichtung landet in einer begrenzten Verlaufshistorie. Rückgängig/Wiederherstellen funktionieren zusätzlich über Cmd/Strg+Z und Cmd/Strg+Shift+Z.
- Nur das Modul-Layout wird dauerhaft gespeichert; Raster, Auswahl und Hilfslinien bleiben reine Editorhilfen und erscheinen nicht in der veröffentlichten App.

## Prüfung
- Logiktests für magnetisches Einrasten, Ausrichtung, Kollisionen und Grenzen ergänzen.
- Oberflächentests für Werkzeugleiste, Auswahl sowie Rückgängig/Wiederherstellen ergänzen.
- Desktop-Vorschau sichtbar prüfen; Smartphone bleibt automatisch gestapelt und frei von Editorwerkzeugen.

## Technische Details
- Reine Layoutfunktionen kommen in die bestehende Layoutbibliothek, damit sie deterministisch testbar bleiben.
- Die Verlaufshistorie sitzt in der freien Layoutansicht und wird bei extern geladenem Layout zurückgesetzt.
- Bestehende gespeicherte App-Layouts bleiben unverändert kompatibel; das Datenmodell muss nicht erweitert werden.
