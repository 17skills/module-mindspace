# API-Module und JEV-Entscheidungen

Ja, beides ist möglich. Zwei neue Modularten kommen dazu.

## 1. API-Modul

Ein Modul, das eine beliebige Web-Schnittstelle abruft (SerpAPI Google Trends, Wetter, Börsenkurse, eigene Endpunkte) und das Ergebnis als Inhalt auf dem Canvas hält.

- Neues Symbol in der unteren Leiste: **API**.
- Im Kontextfenster rechts ein Reiter **Abruf**: Adresse, Methode (GET/POST), optionale Parameter als Name/Wert-Liste, optionaler Text-Körper.
- Zugangsschlüssel werden **nicht** ins Modul getippt, sondern einmal sicher hinterlegt (z. B. `SERPAPI_API_KEY`) und im Modul nur als Platzhalter `{{SERPAPI_API_KEY}}` benutzt. Der Schlüssel verlässt den Server nie und taucht in keiner gespeicherten Adresse auf.
- Knopf „Abrufen“ holt die Daten; das Modul zeigt Zeitpunkt, Status und eine lesbare Vorschau.
- **Feld herausziehen:** Ein Pfad-Feld (z. B. `trending_searches.0.search_volume`) bestimmt, welche Zahl bzw. welcher Text über die Verbindung weitergegeben wird — damit läuft ein API-Wert direkt in Kennzahl, Tacho, Rechnung oder Rechenblatt.
- Die Antwort ist zugleich Chat-Kontext (gekürzt), und die KI-Strukturerkennung kann daraus wie bisher Tabelle/Liste/Diagramm machen.
- Erlaubt sind nur öffentliche https-Adressen; interne Netzadressen werden blockiert.

## 2. JEV-Entscheidungsmodul

JEV liefert typisierte Entscheidungen (Auswahl, Bewertung 0–1, Ja/Nein) statt Fließtext. Es ist in Lovable AI direkt verfügbar (`typesafe/jev-latest`) — OpenRouter wird dafür nicht gebraucht und würde einen eigenen kostenpflichtigen Schlüssel erfordern. Vorschlag: die eingebaute Variante nutzen; ein eigener OpenRouter-Zugang wäre auf Wunsch später nachrüstbar.

- Neues Modul **Entscheidung**: bekommt seinen Kontext aus den eingehenden Verbindungen (Karten, Felder, API-Module).
- Darin eine Liste von Fragen, je Frage: Text, Art (Auswahl mit eigenen Optionen / Bewertung / Ja-Nein), optional Kriterien.
- Knopf „Entscheiden“ zeigt je Frage das Ergebnis mit Sicherheitswert; niedrige Sicherheit wird sichtbar markiert („zur Prüfung“).
- Eine Frage kann als Ausgang markiert werden — ihre Bewertung fließt als Zahl in Kennzahl/Tacho/Rechnung weiter.

## Technische Umsetzung

- Neue Serverfunktionen in `src/lib/api-module.functions.ts` (`requireSupabaseAuth`, zod):
  - `runApiModule`: baut URL/Headers, ersetzt `{{SECRET}}` aus `process.env` serverseitig, prüft https + keine privaten Hosts, Timeout ~20 s, Antwort auf 200 kB gekürzt; gibt `{ status, body, contentType, at }` zurück.
  - `runDecision`: `POST https://ai.gateway.lovable.dev/v1/systemone`, `model: "typesafe/jev-latest"`, `state` = gesammelter Kontext, `questions` aus den Modul-Angaben; Fehlerstatus (402/403/429) werden unverändert durchgereicht und im Modul im Klartext angezeigt.
- Neue Typen `api` und `decision` in `nodes.tsx` (`ApiNode`, `DecisionNode`), registriert in `nodeTypes`, `DEFAULT_SIZE`, kind-Mapping, `NODE_ACCENT`/`NODE_LABEL`, Dock-Menü und `share.$token.tsx` (dort nur lesend, kein Abruf).
- `metadata` api: `url`, `method`, `params`, `body`, `headers`, `pick`, `lastStatus`, `lastAt`; Antwort in `content`.
- `metadata` decision: `questions[]`, `answers`, `outputQuestion`, `at`.
- `calc.ts` → `valueOfNode`: bei `api` der über `pick` gelesene Wert, bei `decision` der Score der Ausgangsfrage.
- Schlüssel wie `SERPAPI_API_KEY` werden über die Secrets-Abfrage erfragt, sobald du den ersten Dienst nutzt.
