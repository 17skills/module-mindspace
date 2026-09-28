# Baukasten anschließen, Vorlagen verlustfrei

Kein Marktplatz, keine Preise, keine Lizenzprüfung, keine YouTube-Suche.

## 1. Export/Import verlustfrei
Ein Scope wird exportiert und wieder eingespielt – und ist danach gleich, bis auf Daten und Schlüssel.
- **Motor bleibt erhalten:** Modell, API-Adresse oder MCP-Werkzeug eines Moduls wird beim Einspielen wieder in die Moduleinstellungen geschrieben (heute nur exportiert, beim Import verworfen).
- **MCP-Verbindungen:** Die Datei nennt Server nach Name, Adresse und Anmeldeart (nie das Token). Beim Einspielen werden sie eigenen Servern mit gleicher Adresse zugeordnet; fehlende erscheinen in der Vorschau als „MCP-Server verbinden“.
- **Regeln:** Regelwerk und Scope-Regeln (Ontologie) kommen als eigener Block in die Datei und werden wiederhergestellt.
- **Version und Herkunft:** Jede Datei trägt Vorlagen-Version, Autor, Erstellzeit, Ursprungs-Scope und Prüfsumme. Jedes Modul, das aus dem Katalog stammt, merkt sich Baustein-Name und -Version.
- **Vorschau vor dem Übernehmen:** Module, Apps, fehlende Schlüssel, fehlende MCP-Server, veraltete Baustein-Versionen – als Klartext, nie Abbruch.

## 2. Katalog an die Oberfläche anschließen
- **Bibliothek im Scope:** Ein Dialog listet die Grundbausteine und ihre Ableitungen nach Gruppe, mit Beschreibung, Ein-/Ausgängen und Freigabepflicht. Ein Klick legt das Modul mit den Voreinstellungen des Bausteins auf den Canvas.
- **Bauplan einspielen:** Eine `.scope.yaml` (Prozess-Format) wird erkannt, geprüft und über den bestehenden Wiederherstellungsweg als Scope aufgebaut.
- **Schutz gilt beim Platzieren:** Freigabepflicht, Token-Budget und Zeitlimit des Bausteins stehen im Modul und werden bei der Ausführung geprüft; Außenwirkungen landen weiter im Ablagefach.
- **Geplante Ausführung:** Wird angezeigt, aber nicht automatisch gestartet (keine Hintergrund-Abrufe ohne Knopfdruck, wie bisher entschieden).

## Prüfung
Rundlauf-Test (Export → Import → gleich, inkl. Motor, MCP, Regeln, Herkunft). Browser-Durchlauf: Baustein aus der Bibliothek platzieren, Bauplan einspielen.

## Technische Details
- `manifest.ts`: Felder `provenance` (version, author, createdAt, origin, checksum), `rules`, `mcpServers` (name,url,auth_kind,header_name), je Modul `module: {name, version}`; `manifestToBackup` schreibt `engine` zurück in metadata (`model`/`agentModel`, `url`, `mcpTool`/`mcpServerName`) und reicht mcpServers durch. `backupToManifest` liest Board-Regelwerk mit aus. Schema bleibt `scopebuilder/v1`, neue Felder optional (alte Dateien gültig).
- `backup.functions.ts`/`importBoard`: Regeln und Herkunft übernehmen; Rückgabe um fehlende Server/Schlüssel erweitern.
- Neue Server-Funktion `listCatalog` (catalogSummary) und `instantiateModule`; `LibraryDialog` bekommt Tab „Bausteine“; Sniffer erkennt `kind: Scope` und nutzt `scopeSpecToManifest → manifestToBackup → importBoard`.
- AGENTS.md: Regel „Katalog ist die einzige Quelle für platzierbare Bausteine; Module tragen Baustein-Name+Version“.
