---
scopebuilder: scopebuilder/v1
scope:
  title: "ZZ Test Ergebnis-Modul"
modules:
  - id: bericht
    type: text
    title: "Prüfbericht"
    at: [0, 0]
    content: "## Ergebnis\n\nTrafo 7 **in Ordnung**, nächste Prüfung 2027."
  - id: ausgang
    type: output
    title: "Ergebnis"
    at: [400, 0]
    size: [420, 380]
links:
  - from: bericht
    to: ausgang
apps:
  - title: "ZZ Test-App"
    modules: [ausgang]
    access: public
---
