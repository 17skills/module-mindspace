# Foto → Ort → Restaurants: sauber über einen Bauplan

## Was ich ehrlich geprüft habe
- Einen eigenen **Kameramodul**-Baustein gibt es noch nicht. Fotos kann bisher nur das Modul „Inspektion“ aufnehmen, und das bewertet Schäden.
- Das **API-Modul** kann keine Werte aus einem vorgeschalteten Modul übernehmen, z. B. den Ort aus dem Foto. Es setzt bisher nur geheime Schlüssel ein.
- Meine letzte Lösung war deshalb eine Sonderlösung neben dem Scopebuilder (ein Extra-Kasten in der App, ein von Hand angelegter Scope). Die nehme ich wieder heraus.

## Was gebaut wird (allgemein, für jeden Scope nutzbar)
1. **Kamera-Modul (Quelle):** Foto aufnehmen oder hochladen. Liefert Foto, Ort (aus dem Foto oder vom Handy) und Zeit an verbundene Module. Keine KI-Bewertung.
2. **API-Modul übernimmt Werte:** In Adresse oder Anfrage lassen sich Werte aus dem vorgeschalteten Modul einsetzen, z. B. `{{input.lat}}` und `{{input.lon}}`. Nur https, gedrosselt, Antwort gilt als fremder Inhalt.
3. **Karte liest beides:** Die Karte zeigt den Ort aus dem Kamera-Modul und Punkte aus einer API-Antwort (Name, Breiten- und Längengrad).
4. **Ergebnis-Modul:** Zeigt die Restaurantliste. Jeder Durchlauf landet in der Durchlauf-Ablage, so wie heute schon.
5. **Handy-App:** Eine mobile App aus Kamera, Karte und Ergebnis zeigt genau diese Module an und hat keinen eigenen Sondercode.

## Der Bauplan (YAML)
Eine Datei `foto-restaurants.scope.yaml` beschreibt den ganzen Scope: Kamera → API (OpenStreetMap-Restaurants, 1 km) → Karte + Ergebnis, dazu eine mobile App. Eingespielt wird sie über den normalen Weg „Bauplan einspielen“ mit Vorschau. Der Test-Scope entsteht damit ohne Eingriff von Hand. Die Datei liegt danach auch zum Herunterladen bereit.

## Aufräumen
- Den Extra-Kasten in der Handy-App und die Markierung `nearby` entferne ich.
- Den von Hand angelegten Test-Scope und die Test-App lösche ich.

## Prüfung
- Tests für: Einsetzen der Werte (auch Schutz gegen eingeschleuste Adressen), Kamera-Ort und Bauplan-Einlesen.
- Browser-Test in Handygröße: Bauplan einspielen, App öffnen, Foto mit Ort hochladen. Danach müssen Karte und Restaurantliste erscheinen und der Durchlauf in „Ergebnisse“ stehen.

## Technische Details
- Neuer Knotentyp `camera` (Rolle source) in Board-Modulliste, `SOURCE_TYPES`, Gastansicht und App-Layout (`resolveLayout`: camera → capture-ähnliches Layout, generisch gerendert).
- `api-module.functions.ts`: Platzhalter `{{input.*}}` werden aus der Momentaufnahme des verbundenen Upstream-Knotens befüllt, URL-kodiert, nur Zahlen/kurze Strings; Hosts weiterhin nur https, keine privaten Netze.
- `pointsFromSources` um `camera` und `api` (JSON-Pfad zu Liste mit lat/lon/name) erweitern.
- Rückbau: `NearbyPanel.tsx`, `appNearbyRestaurants` und der Zweig in `app.$appId.tsx` entfallen; die reine Hilfsfunktion `parsePlaces` wird nicht mehr gebraucht und fällt ebenfalls weg.
