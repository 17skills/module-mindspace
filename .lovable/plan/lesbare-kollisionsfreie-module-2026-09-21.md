# Lesbare, kollisionsfreie Module

## Umsetzung
- Geöffnete inhaltsreiche Module erhalten passende Mindestbreiten: Faktoren breiter für Text und Gewichtung, Entscheidungen breiter für Regeln, Risikomatrix breit genug für Tabelle und Matrix.
- Beim erstmaligen Öffnen beziehungsweise Auswählen wird ein zu schmales Modul automatisch auf seine lesbare Zielbreite vergrößert; manuell bereits größere Breiten bleiben erhalten.
- Benachbarte, nicht gruppierte Module werden dabei horizontal oder vertikal auf den nächsten freien Platz verschoben, mit einem einheitlichen Sicherheitsabstand.
- Positionen und Größen werden gespeichert, damit die bereinigte Anordnung beim erneuten Öffnen erhalten bleibt.
- Module innerhalb von Gruppen oder Hintergrundfeldern bleiben in ihren Begrenzungen und werden nicht automatisch aus dem Container geschoben.

## Technische Details
- Die Logik wird zentral auf Canvas-Ebene umgesetzt und nutzt die vorhandenen Modulgrößen und Koordinaten.
- Rechteck-Kollisionen werden nur für sichtbare Inhaltsmodule geprüft; Hintergrundfelder, Gruppenrahmen, Formen und Überschriften werden nicht als Hindernisse behandelt.
- Der bestehende manuelle Größenregler bleibt verfügbar.

## Prüfung
- Faktor, Entscheidung und Risikomatrix nacheinander auswählen und Breite sowie Abstand prüfen.
- Gespeicherte Größen und Positionen nach Neuladen kontrollieren.
- Desktop-Ansicht auf abgeschnittene Inhalte und überlappende Karten prüfen.
