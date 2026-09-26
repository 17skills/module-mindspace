# Roadmap

- [x] Entscheidung statusorientiert und kompakt gestalten
- [x] Risikomatrix auf Kernaussagen reduzieren
- [x] Karte mit Wetterstatus und Objektzahl priorisieren
- [x] Signale, Kennzahlen, Notizen und Tabellen verdichten
- [x] Vollständiges Board visuell und technisch prüfen
- [x] Modulhöhen automatisch an sichtbare Inhalte anpassen und Kollisionen bereinigen
- [x] Ausgewählte Module automatisch übersichtlich und kollisionsfrei anordnen
- [x] Feld-Apps mit eigenem Titel, Logo, Akzentfarbe und Hintergrund gestalten
- [x] Wiederverwendbare Designprofile, Live-Vorschau und SVG-/PNG-Logoeditor ergänzen

- [x] Studio-zu-App: Modulauswahl (max. 5), App-Ansicht-Dialog, /app/$appId (mobile Erfassung + Lagebild-Cockpit), App-Übersicht auf der Startseite
- [x] MCP-Werkzeuge je App (report_finding, get_findings, update_finding_status, get_kpis, get_app) an den App-Endpunkt binden
- [x] Umbenennung in scopebuilder; Boards heißen Scopes
- [x] MCP-Endpunkt mit App-Schlüssel (Bearer/?token=) und Rechten Lesen / Lesen+Schreiben
- [x] Integrierte KI-Anleitung: Claude-Desktop-Konfiguration, Copilot/Cursor-Schritte, Verbindungstest, Beispielanfragen
- [x] Offline-Modus der mobilen Erfassung (Warteschlange im Gerät, Auto-Sync bei Netz)
- [x] Startseite: Beschreibungen für Scopes und Apps, Vorschaubilder auf den Karten
- [x] Scope-Freigabe mit Rollen (Lesen / Bearbeiten) inkl. RLS-Trennung
- [x] App-Module auf einer freien Rasterfläche positionieren, skalieren und dauerhaft speichern
- [x] Freie App-Layouts mit Raster, Magnet, Hilfslinien, Ausrichtung sowie Rückgängig/Wiederherstellen ergänzen
- [x] Globale Suche über alle Scopes (Karten, Felder, Verbindungen, Texte) mit Sprung zum Modul
- [x] Vollständige Sicherung und Wiederherstellung eines Scopes als JSON-Datei
- [x] Echtzeit-Abgleich von Modulen, Verbindungen und Positionen ohne Neuladen
- [x] Rollenbasierte Rechte für bereitgestellte Apps: Ansehen, Daten aktualisieren, Konfiguration verwalten
- [x] Öffentliche Schreibwege der Apps serverseitig absichern
- [x] Rechteverwaltung und rollenabhängige App-Oberfläche prüfen

- [x] Live-Vorschauen mit realistischen grünen, gelben und roten Kennzahlzuständen
- [x] Klickbare Module, Kennzahlen und Direktlinks in Cockpit- und Teams-Vorschau
- [x] Veröffentlichungsvalidierung für Titel, Leitfrage, Zielgruppe und Kennzahlen
- [x] Canvas-Rendering auf sichtbare Module begrenzen und Zusammenarbeit entlasten
- [x] Schnelle Moduländerungen beim Speichern bündeln
- [x] Canvas-Werkzeugleiste, Auswahlstatus und leeren Scope vereinfachen

## Scope-Manifest (Plan 2026-09-26)
- [x] Manifest-Format scopebuilder/v1 mit Rollen, Motoren, Verbindungen, Apps + Kanälen
- [x] Bauplan exportieren (Markdown mit YAML-Kopf) und einspielen (YAML/MD) inkl. Apps
- [x] Ergebnis-Modul (Bild, Video, Audio, PDF, Bericht; Folien/3D als Download) auf Canvas und in Apps
- [ ] Browser-Vorschau für Folien und 3D im Ergebnis-Modul
- [ ] Mobiler App-Eingang (Foto rein → Agent → Ergebnis)
- [x] Gastansicht geteilter Scopes sicherheitlich prüfen
- [x] Regressionstests: Gäste kommen nicht an private Dateien, Daten oder Aktionen
- [x] Durchlauf-Ablage: Liste/Galerie je Ergebnis, Nachweis, Löschfristen, unveränderliches Protokoll
- [ ] Tägliche Löschung automatisch anstoßen (Zeitplan für /api/public/runs-purge einrichten)
- [ ] Tempo: große Programmteile aufteilen, vorher/nachher messen
- [ ] Motor-Umschalter am Feld (Modell / API / MCP)
- [ ] Gemeinsamer Runner mit Lauf-Protokoll für alle Kanäle
- [ ] Kanal „mobil" in App-Einstellungen, MCP-App leitet Werkzeuge aus Auswahl ab
