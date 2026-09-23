# Canvas-Optimierung: UX und Performance

## Ziel
Der Scope-Editor bleibt für Desktop-Arbeit optimiert. Zoomen, Verschieben, Auswählen und Bearbeiten sollen auch bei umfangreicheren Scopes flüssiger werden; veröffentlichte Apps und fotoorientierte Module bleiben mobil nutzbar.

## Umsetzung
1. **Sichtbaren Bereich priorisieren**
   - Nur Module außerhalb des sichtbaren Ausschnitts aus der Darstellung nehmen, ohne Daten oder Auswahl zu verlieren.
   - Aufwendige Canvas-Ebenen und Anwesenheitshinweise nur aktualisieren, wenn sich ihre relevanten Daten ändern.

2. **Interaktionen entlasten**
   - Mauszeiger-Synchronisierung während Ziehen und Zoomen reduzieren, ohne die sichtbare Zusammenarbeit zu verlieren.
   - Größenmessungen und automatische Kartenanpassungen gezielter auslösen, damit Textänderungen nicht unnötig den ganzen Canvas vermessen.
   - Die Übersichtskarte während intensiver Interaktionen vereinfachen und auf kleinen Ansichten ausblenden.

3. **Speichern bündeln**
   - Schnell aufeinanderfolgende Änderungen am selben Modul kurz sammeln und zu einer Aktualisierung zusammenführen.
   - Offline-Warteschlange, Konfliktauflösung, Echtzeit-Synchronisierung und Speicherstatus unverändert erhalten.

4. **Bedienung klarer machen**
   - Auswahlstatus mit Anzahl und eindeutigen Sammelaktionen direkt an der Werkzeugleiste zeigen.
   - Häufige Aktionen priorisieren und seltene Einfügeoptionen in klare Menüs bündeln, damit die Leiste weniger überladen wirkt.
   - Leere Scopes mit direkt anklickbaren Startaktionen statt einer reinen Erklärung versehen.

5. **Prüfung**
   - Desktop-Canvas mit Maus und Trackpad testen: Zoomen, Verschieben, Einzel-/Mehrfachauswahl, Ziehen, Größenänderung und Speichern.
   - Einen Scope mit etwa 30 Modulen auf Renderlast, sichtbare Ruckler und unnötige Netzaufrufe prüfen.
   - Sicherstellen, dass veröffentlichte App-Ansichten und fotoorientierte Nutzung mobil unverändert funktionieren.

## Technische Details
- React-Flow-Sichtbarkeitsoptimierung und stabile, memo-isierte Datenübergaben.
- Kurze, pro Modul zusammengefasste Schreibvorgänge statt einzelner direkter Anfragen.
- Keine Änderung an Berechnungslogik, Rechten, MCP-Funktionen oder App-Veröffentlichung.
