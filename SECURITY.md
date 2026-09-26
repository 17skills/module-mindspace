# Sicherheitsstand scopebuilder (26.09.2026)

Bewertung: erfüllt / teilweise / offen. Keine pauschale Zusage.

## OWASP LLM Top 10
| Punkt | Stand | Beleg |
|---|---|---|
| LLM01 Prompt Injection | teilweise (nicht vollständig ausschließbar) | Fremde Inhalte als `<daten>` abgegrenzt (`src/lib/untrusted.ts`) in Chat, Feld-Agent und JEV-Faktorbewertung; MCP-Antworten gelangen nur über den Chat (abgegrenzt) an Modelle; Modelle lösen keine Wirkung aus |
| LLM02 Unsichere Ausgabe | erfüllt | Markdown-Rendering ohne HTML; kein `dangerouslySetInnerHTML` mit Nutzerinhalt |
| LLM05 Ausgabe ungeprüft weiterverarbeitet | erfüllt | Agent/JEV/Faktor über Zod-Schema |
| LLM06 Zu viel Handlungsfreiheit | erfüllt | Aktionen nur über Ablagefach mit menschlicher Freigabe |
| LLM10 Unbegrenzter Verbrauch | erfüllt | Chat nur angemeldet, 30/min je Nutzer, Größenlimits |

## OWASP Top 10 (Web)
| Punkt | Stand | Beleg |
|---|---|---|
| A01 Zugriffskontrolle | erfüllt | RLS auf allen Tabellen, `assertBoardRole`/`assertNodeRole`, Sperrprüfung; Chat-Zugang jetzt mit Anmeldung |
| A03 Injection | erfüllt | Zod-Validierung, parametrisierte Abfragen |
| A05 Fehlkonfiguration | erfüllt | CSRF-Middleware für Serverfunktionen, Datenbank-Scan ohne Befund |
| A06 Veraltete Komponenten | teilweise | js-yaml (über Framework) und esbuild (über MCP-Paket, nur Entwicklung) mit bekannten Meldungen; Behebung wartet auf Updates der Pakete |
| A07 Authentifizierung | erfüllt | Anmeldung serverseitig geprüft (`getUser`); App-Schlüssel in konstanter Zeit verglichen, Fehlversuche gedrosselt |
| A08 Datenintegrität | erfüllt | Bauplan-Import verwirft Schlüssel, Freigaben, Journal-Bezüge; Entscheidungs-Journal unveränderlich |
| A10 SSRF | erfüllt | Nur https, private/interne Adressen gesperrt (API- und MCP-Module) |

## Offen
- Aufteilen der großen Canvas-Dateien für schnelleres Laden (Tempo, keine Sicherheitslücke).
- Paket-Updates für js-yaml/esbuild, sobald verfügbar.
