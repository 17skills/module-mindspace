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

- Scope-Manifest `scopebuilder/v1` (src/lib/runtime/manifest.ts, YAML) ist das Austauschformat; Canvas und App sind Projektionen, Import läuft über manifestToBackup → importBoard. Verlustfrei: `engine` schlägt beim Import Einstellungen, `mcpServers` (ohne Token), `rules`, `governance` und `provenance` reisen mit. Warum: ein Vertrag, ein Wiederherstellungspfad, keine Daten und Schlüssel im Bauplan.
- Fremde Inhalte gehen nur über `wrapUntrusted` an Modelle; Modelle lösen nie selbst Wirkungen aus (Ablagefach). Warum: Prompt Injection ist nur im Schaden begrenzbar.
- `/api/chat` verlangt Bearer-Token, Sperrprüfung und Drosselung; Aufrufe über `postChat`. Warum: offener KI-Zugang kostet und ist missbrauchbar.
- Ergebnis-Modul (`type: "output"`, src/lib/output.ts) hält eine Momentaufnahme der Quellkarte in `metadata.output`; Dateien werden serverseitig nur über den Pfad der Quellkarte desselben Scopes signiert. Warum: ein Modul darf keine fremden Dateien freischalten.
- Durchläufe liegen in `runs`, Protokoll in `run_events` (nur anhängen, Trigger sperrt Änderungen); Canvas zeigt nur den Zählwert. Warum: auditierbarer Nachweis ohne Überschreiben.
- Bausteine (`kind: ScopeModule`, `*.scopem.yaml`, src/lib/runtime/scopem.ts) und Prozesse (`kind: Scope`, scope-spec.ts) sind deklarativ; Kern-Katalog als YAML in src/lib/runtime/catalog/ über `scopeSpecToManifest`. Warum: Bibliothek statt Code je Anwendungsfall, headless-fähig.
- Katalog enthält nur primitive Archetypen (http-request, llm-inference, rule-gate, tabular-data, mcp-tool-call, audio-synthesis, camera, map, output, zone); Fachmodule sind Spezialisierungen via `spec.extends`+`presets` (`resolveModuleInheritance`), die Schutz nur verschärfen. Er ist zugleich die einzige Quelle fürs Platzieren (`catalogModulePayload`, jede Karte trägt `moduleRef`). Warum: ein Update am Archetyp erreicht alle Ableitungen, Hand und Bauplan erzeugen Gleiches.
- Canvas hält nur Referenzen: Zeilen liegen in `dataset_rows` (RLS über `datasets`), gerechnet wird per SQL-RPC (`dataset_aggregate`, `dataset_query_rows`, `dataset_bbox`, `dataset_rule_check`, `dataset_sql` nur lesend) über src/lib/datasets.server.ts; Karte lädt max. 300 Punkte im Ausschnitt, Diagramm nur Gruppensummen, Agent nur Schema plus gedeckeltes `dataset_query`; `storage_path` (JSONL) bleibt lesbar, `stripData` trägt nie Zeilen. Warum: große Tabellen werden dort gerechnet, wo sie liegen.
- Diagramme werden nie aus der Spaltenreihenfolge befüllt: `metadata.chartConfig` (src/lib/chart-config.ts) hält die bestätigte Auswahl. Warum: der Nutzer bestimmt die Daten.
- Jeder Ablauf läuft über `runFlow` (src/lib/flow-run.server.ts); App und `/api/public/scopes/:boardId/run` (Scope-Schlüssel in `api_keys`, sha256) teilen ihn, Durchläufe tragen `origin` und `api_key_id`. Warum: ein Ausführungspfad, ein Nachweis.
- KI-Aufrufe sind gedeckelt (`readBudget`/`BudgetMeter`, src/lib/budget.ts, Verbrauch in `ai_usage`), laufen durch `redactPii` (src/lib/pii.ts, Modus aus `boards.rules.privacy`) und je Schritt durch `withTimeout` (Durchlauf max. 300 s). Warum: keine offenen Kosten, keine persönlichen Daten an Modelle, keine Endlosschritte.
- Jede Karte trägt eine Rolle (`metadata.moduleRole`, src/lib/module-role.ts): nur `module` belegt eine Kachel, `briefing` wird Einleitung, `reference`/`action` Fußbereich, `prompt`/`draft` nie. Warum: die App bleibt aufgeräumt.
- Entwickler-Werkzeuge (DeveloperDialog.tsx) nur für `admin`/`developer`, serverseitig über `getMyRoles` und `has_role`. Warum: Schlüsselverwaltung ist kein Stoff für Fachanwender.
- KI-Governance eines Scopes liegt in `boards.rules.governance` (src/lib/governance.ts), Standard `minimal`/`draft`; ab `limited` zeigt die App einen KI-Transparenzhinweis. Warum: ISO 42001 / EU AI Act verlangen eine maschinenlesbare Einstufung.
- Modellbindung je Modul: `metadata.engine` (src/lib/module-engine.ts) hält nur `provider`, `model`, `maxTokens`; `resolveRoute` (src/lib/ai-keys.server.ts) setzt sie vor das Profil-Routing und fällt ohne Schlüssel auf den Standard zurück. Adresse und Schlüssel lokaler Kerne nur aus `AI_LOCAL_*` der Server-Umgebung. Fähigkeiten prüfen Anbieterangaben (src/lib/model-registry.server.ts, 6 h Cache) vor Namensmustern. Warum: verschiedene Agenten, verschiedene Modelle — portabel ohne Ports und Geheimnisse.
- Erscheinungsbild und Sprache: src/lib/theme.tsx und src/lib/i18n/ (`de.ts`/`en.ts`, `useTranslation()`); Wahl liegt lokal im Browser und spiegelt sich in `settings.theme`/`settings.language`. Warum: sofortige Umschaltung, trotzdem geräteübergreifend gleich.
- App-Branding ist zweistufig: `organizations.branding` (`readOrgBranding`, src/lib/zones.ts) ist der Standard, `apps.branding.inherit` entscheidet je App, `mergeBranding` führt beides serverseitig in `getPublicApp` zusammen. Warum: ein Scope mehrfach white-label, ohne Logik zu duplizieren.
- OpenUI-Ausgaben nur über die Whitelist in src/components/genui/library.tsx; Aktionen nur als Signal. Warum: Modelle erzeugen nur wirkungsfreie Bausteine.
- Inspektionsbefunde liegen je Zeile in `inspection_findings` (src/lib/inspection-store.ts, `attachFindings`/`insertFinding` in app-data.server.ts), nicht in `nodes.metadata.findings` (nur Altbestand). Warum: viele Erfasser gleichzeitig, ohne dass der offene Canvas Befunde überschreibt.
