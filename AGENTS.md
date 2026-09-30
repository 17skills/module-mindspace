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


- Canvas hält nur Referenzen: Tabellenzeilen liegen relational in `dataset_rows` (Postgres, RLS über `datasets`), gerechnet wird per SQL-RPC (`dataset_aggregate`, `dataset_query_rows`, `dataset_bbox`, `dataset_rule_check`) über `src/lib/datasets.server.ts`; Karte lädt nur den sichtbaren Ausschnitt (max. 300 Punkte), Diagramm nur Gruppensummen, der Chat-Agent nur Schema plus gedeckeltes Werkzeug `dataset_query`; Altbestände mit `storage_path` (JSONL) bleiben lesbar; Baupläne (`stripData`) tragen nie Zeilen; scope deklariert `spec.datasets` + `mapping`, scopem nutzt `data:table-ref`. Warum: große Tabellen werden dort gerechnet, wo sie liegen — nicht im Browser, nicht im Prompt.
- Katalog ist die einzige Quelle für platzierbare Bausteine: Platzieren läuft über `catalogModulePayload` → `scopeSpecToManifest`, jede Karte trägt `moduleRef` (name@version). Warum: Hand-Platzierung und Bauplan erzeugen identische Module, Updates bleiben nachvollziehbar.
- Manifest ist verlustfrei: `engine` hat beim Import Vorrang vor Einstellungen, `mcpServers` (ohne Token), `rules` und `provenance` (Prüfsumme über normalisierte Form) liegen in `boards.rules`/`boards.provenance`. Warum: Vorlage = vollständiger Scope ohne Daten und Schlüssel.
- Jeder Ablauf (Quelle→Schritte→Ergebnis) läuft über `runFlow` in src/lib/flow-run.server.ts; App und Headless-Endpunkt `/api/public/scopes/:boardId/run` (Scope-Schlüssel in `api_keys`, sha256-Hash) teilen ihn, Durchläufe tragen `origin` und `api_key_id`. Warum: ein Ausführungspfad, ein Nachweis.
- KI-Aufrufe sind hart gedeckelt: `readBudget`/`BudgetMeter` (src/lib/budget.ts) erzwingen `engine.governance.maxTokenBudget` des Bausteins, sonst den Standarddeckel; Verbrauch landet in `ai_usage`. Warum: unkontrollierte Kosten sind für Unternehmen ein Ausschlusskriterium.
- Jeder Modellaufruf läuft durch `redactPii` (src/lib/pii.ts; Modus aus `boards.rules.privacy`, Baustein nur verschärfend) und jeder Ablaufschritt durch `withTimeout` (src/lib/budget.ts, Durchlauf max. 300 s). Warum: keine persönlichen Daten an Modelle, keine endlos laufenden Schritte.

- Diagramme werden nie automatisch aus Spaltenreihenfolge befüllt: `metadata.chartConfig` (src/lib/chart-config.ts) hält die vom Nutzer bestätigte Auswahl; gerechnet wird in Postgres (`dataset_aggregate`) oder im Experten-Modus über `dataset_sql` (nur lesend, Alias `data`, 3 s, 500 Zeilen). Warum: der Nutzer bestimmt die Daten, die Datenbank die Last.

- Jede Karte trägt eine Rolle (`metadata.moduleRole`, src/lib/module-role.ts): nur `module` belegt eine Kachel in der App, `briefing` rendert als Einleitung, `reference`/`action` als Fußbereich, `prompt`/`draft` nie. Warum: Textzettel und Links sind Prompt, Quelle oder Notiz — die App bleibt trotzdem aufgeräumt.

- Entwickler-Werkzeuge (Knopf „Code & Schnittstelle" im Canvas, `src/components/canvas/DeveloperDialog.tsx`) sind nur für die Rollen `admin` und `developer` sichtbar; geprüft serverseitig über `getMyRoles` (src/lib/account.functions.ts) und `has_role`. Warum: Aufrufbeispiele und Schlüsselverwaltung sind kein Stoff für Fachanwender.

- KI-Governance eines Scopes (Risikostufe, Zweck, Verantwortung, Status, menschliche Freigabe) liegt in `boards.rules.governance` (src/lib/governance.ts) und reist als Top-Level-Abschnitt `governance` im Manifest mit; Standard ist `minimal`/`draft`, ab `limited` zeigt die App einen KI-Transparenzhinweis. Warum: ISO 42001 / EU AI Act verlangen eine maschinenlesbare Einstufung am System selbst, ohne Prototyping auszubremsen.

- Modulspezifische Modellbindung: `metadata.engine` (src/lib/module-engine.ts) hält nur `provider` (default|openrouter|openai|anthropic|google|local), `model` und `maxTokens` und reist so im Manifest mit; `resolveRoute` (src/lib/ai-keys.server.ts) setzt sie vor das Profil-Routing und fällt ohne Schlüssel bzw. ohne eingerichteten lokalen Server auf den Standard zurück. Adresse und Schlüssel lokaler Rechenkerne kommen ausschließlich aus `AI_LOCAL_BASE_URL`/`AI_LOCAL_API_KEY`/`AI_LOCAL_MODEL` der Server-Umgebung. Warum: verschiedene Agenten brauchen verschiedene Modelle, und ein Bauplan muss ohne Ports, Adressen und Geheimnisse portabel bleiben (auch für eigenen VPS).
- Modellfähigkeiten: Anbieterangaben (`src/lib/model-registry.server.ts`: OpenRouter-Modellliste, Ollama `/api/show`, 6 h Cache) haben Vorrang vor den Namensmustern in `module-engine.ts`; UI und Server-Wächter nutzen dieselbe Prüfung. Warum: neue Modelle sind prüfbar, ohne die Liste von Hand zu pflegen.
