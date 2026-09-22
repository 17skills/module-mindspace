# Frei positionierbare App-Module

## Ziel
In der App-Gestaltung können die ausgewählten Module direkt in der Live-Vorschau frei angeordnet und in ihrer Größe verändert werden. Die ausgelieferte App übernimmt exakt dieses Layout.

## Umsetzung
- Einen neuen Aufbau **Freie Fläche** ergänzen.
- Jedes Modul erhält im Editor einen Ziehbereich sowie einen Größenregler an der Ecke.
- Position und Größe werden auf einem stabilen Raster ausgerichtet, damit Module sauber zueinander stehen.
- Kollisionen und Positionen außerhalb der Fläche werden beim Ablegen begrenzt.
- Smartphone und Desktop erhalten getrennt brauchbare Darstellung: Das freie Desktop-Layout wird mobil automatisch in eine lesbare Reihenfolge überführt.
- Modulpositionen und -größen werden zusammen mit der App gespeichert und beim späteren Bearbeiten wieder geladen.
- Die ausgelieferte öffentliche App verwendet dieselbe gespeicherte Anordnung.

## Prüfung
- Automatische Tests für Positionierung, Größenänderung, Speicherung und erneutes Laden ergänzen.
- Live-Vorschau und öffentliche App auf Desktop und Smartphone prüfen.

## Technische Details
- Das freie Layout wird als zusätzliche Layoutart geführt.
- Pro Modul werden normalisierte Rasterwerte für Spalte, Zeile, Breite und Höhe im vorhandenen App-Gestaltungsobjekt gespeichert.
- Bestehende Apps und bisherige Layouts bleiben unverändert kompatibel.
