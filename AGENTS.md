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
