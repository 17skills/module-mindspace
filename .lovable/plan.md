# Englische Oberfläche vervollständigen

## Ziel
Alle nutzungsrelevanten Bereiche wechseln konsistent zwischen Deutsch und Englisch. Der Schwerpunkt liegt auf Canvas, Modulen, Inspektor, Bibliothek, App-Erstellung sowie deren Dialogen; anschließend werden die übrigen Kernansichten geschlossen.

## Umsetzung
1. **Sprachsystem erweitern**
   - Wörterbücher nach Bereichen strukturieren und um Platzhalter für dynamische Texte ergänzen.
   - Den Übersetzungshelfer so erweitern, dass Namen, Anzahlen und Statuswerte sicher eingesetzt werden können.
   - Deutsche Texte bleiben Referenz; gespeicherte Nutzerinhalte, technische IDs und importierte Inhalte werden nicht übersetzt.

2. **Canvas und Module übersetzen**
   - Canvas-Leisten, Menüs, Kontextaktionen, Status- und Fehlermeldungen anbinden.
   - Modulkarten, Modultypen, Daten-, Quellen-, Agenten-, API-, Diagramm-, Rollen-, Zuordnungs- und Leitfadenbereiche übersetzen.
   - Barrierefreie Beschriftungen und Tooltips ebenfalls umschaltbar machen.

3. **Dialoge und App-Erstellung übersetzen**
   - Teilen, Bibliothek, Vorlagen, Versionen, Durchläufe, Zugriffsrechte, Governance, Datenschutz, Entwicklerzugang und MCP-Verbindung abdecken.
   - App-Konfiguration, Vorschau, Kanäle, Geräte, Branding, Prüfhinweise und Rückmeldungen übersetzen.

4. **Übrige Kernansichten schließen**
   - Start-/Scope-Übersicht, Suche, Authentifizierung, geteilte Ansichten und zentrale Kontoansichten anbinden.
   - Fach- und Rechtstexte bleiben in dieser Runde unverändert; sie benötigen eine redaktionell freigegebene Übersetzung statt bloßer UI-Übersetzung.

5. **Prüfen**
   - Automatischer Test auf identische Schlüssel in Deutsch und Englisch.
   - Relevante vorhandene Tests ausführen.
   - Die englische Oberfläche im Browser auf Smartphone und Desktop prüfen: Canvas öffnen, Module ansehen und zentrale Dialoge durchgehen.

## Technische Details
- Bestehendes leichtgewichtiges `useTranslation()`-System bleibt erhalten; keine neue Abhängigkeit.
- Wiederkehrende Fachbegriffe erhalten zentrale Schlüssel, bereichsspezifische Texte eigene Namensräume.
- Für außerhalb von React benötigte Beschriftungen wird eine sprachabhängige Übersetzungsfunktion bereitgestellt, statt deutsche Konstanten zu duplizieren.
- Geschäftslogik, Datenmodell, Rechte und gespeicherte Scope-Inhalte bleiben unverändert.
