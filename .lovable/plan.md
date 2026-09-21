# Spatial Digital Twin — Einstieg: Karte + Risikokarte

Wir bauen jetzt nur die beiden zusammengehörenden Module: **Kartenmodul** und **Risikokarte**. Die übrigen Ideen werden als Projektgedächtnis festgehalten und später Schritt für Schritt umgesetzt.

## 1. Kartenmodul (neuer Modultyp „Karte")

Ein Modul auf der Arbeitsfläche, das eine echte Landkarte zeigt (OpenStreetMap, ohne Zugangsschlüssel).

- **Punkte:** Kommen aus einer verbundenen Tabelle/CSV oder aus einem API-Modul. Spalten für Bezeichnung, Breitengrad, Längengrad sowie optional Klasse/Typ (z. B. Gebäudeklasse) und Wert werden im Kontextfenster zugeordnet; das Modul rät die Zuordnung anhand üblicher Spaltennamen vor.
- **Wetter:** Knopf „Wetter holen" lädt für jeden Punkt Niederschlag, Wind und Temperatur (Open-Meteo, kein Schlüssel). Jeder Punkt bekommt einen farbigen Ring nach Regenmenge; oben steht der Zeitpunkt des letzten Abrufs. Kein automatischer Abruf — wie bei der Krypto-Simulation nur per Knopf.
- **Karte:** Zoomen, Verschieben, Klick auf einen Punkt zeigt seine Angaben. Auswahl eines Punktes hebt ihn hervor.
- **Weitergabe:** Über den Ausgang fließt die Liste der Punkte samt Wetterwerten an das nächste Modul; als Zahl gibt das Modul die Anzahl gefährdeter Punkte weiter.

## 2. Risikokarte (neuer Modultyp „Risiko")

Nimmt die Punkte der Karte entgegen und ordnet sie in ein Raster aus **Eintrittswahrscheinlichkeit** (Wetterlage) und **Auswirkung** (Bedeutung des Objekts).

- 5×5-Raster mit Farbverlauf grün → gelb → rot, jeder Punkt als Kügelchen im passenden Feld, Klick zeigt den Namen.
- Regeln in eigenen Worten pro Stufe: Schwellen für Regenmenge und Wind sind einstellbar (z. B. „ab 25 mm/h = hoch"), Auswirkung wahlweise aus einer Spalte oder je Klasse gesetzt.
- Kopfzeile: Anzahl Objekte je Stufe und die höchste erreichte Stufe.
- Ausgang: höchste Risikostufe als Zahl (1–5) — damit lässt sich die vorhandene Ampel oder das Entscheidungsmodul direkt anschließen.

Beides erscheint in der unteren Leiste, ist verbindbar, in Gruppen und Feldern nutzbar, in der Bibliothek speicherbar und in der geteilten Nur-Lesen-Ansicht sichtbar.

## Merkliste für später (vorgemerkt, nicht Teil dieses Schritts)

1. Drill-Down: Klick auf ein Objekt öffnet dessen eigenes Unter-Board (Grundriss als Hintergrundfeld) mit Rückfluss des Status nach oben.
2. Zeitachse/Szenarien: Regler für Zeitpunkte und Was-wäre-wenn-Läufe.
3. Statische Stammdaten je Objekt (Gebäudeklassen, Typenbezeichnungen) gemischt mit Live-Daten.
4. Handlungsanweisungen aus dem Entscheidungsmodul als abhakbare Maßnahmen.

## Technische Umsetzung

- Karten-Darstellung mit `leaflet` + `react-leaflet`, nur im Browser geladen (`React.lazy` hinter `<ClientOnly>`), Kacheln von OpenStreetMap; kein statischer Import aus einer SSR-Route.
- Neue Typen `map` und `risk` in `nodes.tsx` (`MapNode`, `RiskNode`), registriert in `nodeTypes`, `DEFAULT_SIZE` (Karte 520×420, Risiko 420×380), kind-Mapping, `NODE_ACCENT`/`NODE_LABEL`, Dock-Menü, `collectContext` und `share.$token.tsx` (dort nur lesend).
- `src/lib/geo.ts`: `GeoPoint { id, label, lat, lon, klass, impact }`, `readMapConfig/readRiskConfig`, Spalten-Erkennung aus Tabellen-Modulen (`metadata.rows/columns`) und JSON-Antworten von API-Modulen, `riskCell(point, thresholds)`, `maxRisk(points)`.
- Wetter über die vorhandene Serverfunktion `runApiModule` (Open-Meteo `forecast?latitude=…&longitude=…&current=precipitation,wind_speed_10m,temperature_2m`), gebündelt in einem Aufruf je bis zu 50 Punkten; Ergebnis in `metadata.weather` mit Zeitstempel.
- `metadata` map: `columns`, `points`, `weather`, `lastAt`, `center`, `zoom`. `metadata` risk: `rainWarn`, `rainDanger`, `windWarn`, `windDanger`, `impactBy`, `impactMap`.
- `calc.ts` → `valueOfNode`: bei `map` Anzahl gefährdeter Punkte, bei `risk` die höchste Risikostufe.
- `library.ts` → `RESULT_KEYS` um `points`, `weather`, `lastAt` erweitern, damit „Leer einfügen" sauber bleibt.
