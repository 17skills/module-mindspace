<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

- Scope-Manifest `scopebuilder/v1` (src/lib/runtime/manifest.ts, YAML oder Markdown mit YAML-Kopf) ist das austauschbare Format für Export/Import; Canvas und App-Kanäle sind Projektionen, Import läuft über den Sicherungsweg (manifestToBackup → importBoard). Warum: ein Vertrag für Mensch, Bot und Marktplatz, ohne zweiten Wiederherstellungspfad.
- Fremde Inhalte gehen nur über `wrapUntrusted` an Modelle, und Modelle lösen nie selbst Wirkungen aus (Ablagefach). Warum: Prompt Injection ist nicht ausschließbar, nur der Schaden begrenzbar.
- `/api/chat` verlangt Bearer-Token, Sperrprüfung und Drosselung; Aufrufe laufen über `postChat`. Warum: offener KI-Zugang kostet und ist missbrauchbar.
- Ergebnis-Modul (`type: "output"`, `src/lib/output.ts`) hält eine Momentaufnahme der verbundenen Karte in `metadata.output`; Apps signieren Dateien serverseitig nur über den Pfad der Quellkarte desselben Scopes. Warum: fester Ausgang statt wild erzeugter Karten, und ein Modul kann keine fremden Dateien freischalten.

- Durchläufe (Eingabe→Ergebnis) liegen in `runs`, Protokoll in `run_events` (nur anhängen, Trigger sperrt Änderungen); Canvas zeigt nur Zählwert. Warum: viele Nutzer überschreiben sich nicht, Nachweis bleibt auditierbar.

- Bausteine (`kind: ScopeModule`, `*.scopem.yaml`, src/lib/runtime/scopem.ts) und Prozesse (`kind: Scope`, scope-spec.ts) sind deklarativ; Kern-Katalog als YAML in src/lib/runtime/catalog/, abgebildet über `scopeSpecToManifest`. Warum: Bibliothek statt Code je Anwendungsfall, headless-fähig.

- Katalog enthält nur primitive Archetypen (http-request, llm-inference, rule-gate, tabular-data, mcp-tool-call, audio-synthesis, camera, map, output, zone); Fachmodule sind Spezialisierungen via `spec.extends`+`presets` (`resolveModuleInheritance`), die Schutz nur verschärfen. Warum: ein Update am Archetyp erreicht alle Ableitungen.


- Canvas hält nur Referenzen: vollständige Tabellen liegen versioniert in `datasets` (+ JSONL im Speicher), die Karte trägt `facets.datasetRef` und max. 20 Vorschauzeilen; Karte/Diagramm/Agent/Regelwerk lesen über `queryDataset`/`checkDatasetRule` (gedeckelt), Baupläne (`stripData`) tragen nie Zeilen; scope deklariert `spec.datasets` + `mapping`, scopem nutzt `data:table-ref`. Warum: Daten skalieren und bleiben geschützt, ohne den Scope aufzublähen.
