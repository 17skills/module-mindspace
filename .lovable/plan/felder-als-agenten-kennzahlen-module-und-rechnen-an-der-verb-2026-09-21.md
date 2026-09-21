# Felder als Agenten, Kennzahlen-Module und Rechnen an der Verbindung

## Vorab: gesperrte Felder

Hintergrundfelder lassen sich heute grundsätzlich nicht verbinden – unabhängig von der Sperre. Die Sperre verhindert nur Verschieben, Größenändern und Umbenennen. Mit diesem Schritt bekommen Felder erstmals Verbindungspunkte (rechts/unten als Ausgang), und zwar auch im gesperrten Zustand: gesperrt heißt „liegt fest", nicht „ist stumm".

## 1. Das Feld als Agent

Jedes Hintergrundfeld kann eine Aufgabe bekommen. Es sieht alle Inhalte, die auf ihm liegen (Ermittlung wie bisher über die Lage der Karten), und leitet daraus ein Ergebnis ab.

- Rechtsklick auf ein Feld → „Als Agent einrichten" öffnet das Kontextfenster rechts mit einem neuen Reiter **Agent**.
- Dort: Auftrag in eigenen Worten (z. B. „Bestimme die Zielgruppengröße im deutschen Markt"), Ergebnisart **Zahl** oder **Text**, bei Zahl zusätzlich eine Einheit (€, Stk, %, frei).
- Button „Analysieren" startet die Auswertung. Ergebnis erscheint als Zeile unten im Feld: Wert + Einheit, daneben eine kurze Begründung (aufklappbar), plus Zeitpunkt der letzten Analyse.
- Ändern sich die Inhalte auf dem Feld (dazu, weg, bearbeitet), zeigt das Feld ein „veraltet"-Zeichen; neu gerechnet wird erst auf Klick. Kein Guthaben wird ungefragt verbraucht.
- Ohne Auftrag bleibt ein Feld genau wie heute – rein visuell.

## 2. Verbindungen ab dem Feld

Ein Agenten-Feld bekommt einen Ausgang. Seine Zahl fließt über die Verbindung weiter – genau wie der Wert einer Karte. Damit gilt dein Beispiel: Feld „Marktforschung" analysiert die Studie, liefert die Zielgruppengröße, die Verbindung trägt sie zum nächsten Modul.

## 3. Rechnen an der Verbindung

- Das Taschenrechner-Symbol verschwindet aus der unteren Leiste.
- Einfachklick auf eine Verbindung: kleine Blase mit dem Beschriftungsfeld und „Rechnung anlegen" – schließt sich bei Klick daneben.
- Doppelklick auf eine Verbindung: öffnet die Rechnung dieser Verbindung (bzw. legt sie an und hängt sie verbunden dran).

## 4. Neue Dashboard-Module

Über ein neues Symbol „Kennzahlen" in der unteren Leiste (Aufklappmenü wie bei den Formen):

- **Zahl** – große Kennzahl mit Einheit (€, Stk, %, frei), Titel und optionaler Vergleichsangabe. Wert entweder fest eingetragen oder aus einer eingehenden Verbindung.
- **Gauge** – Tachometer-Anzeige mit frei setzbaren Grenzen: Minimum, Maximum und zwei Schwellen (grün → orange → rot).
- **Rechenblatt** – kleines Tabellenblatt: Zeilen mit Name, Wert und optionaler Formel. Eine Zelle kann auf eine andere Zeile (`B2`) oder auf ein eingehendes Modul (`A`, `B`, …) verweisen. Damit lässt sich dein Funnel in einem Modul abbilden: Average Check, Conversion Rate, Umsatz = Average Check × Conversion Rate.

Alle drei sind vollwertige Module: verbindbar, in Gruppen und Feldern nutzbar, in der geteilten Nur-Lesen-Ansicht sichtbar.

## Technische Umsetzung

- **Agent:** `metadata` der Zone erhält `agentTask`, `agentKind` (`number` | `text`), `agentUnit`, `agentResult`, `agentReason`, `agentAt`, `agentFingerprint`. Keine Migration nötig.
  - Neue Serverfunktion `runZoneAgent` in `src/lib/agent.functions.ts` (`requireSupabaseAuth`, zod): nimmt Auftrag + gesammelte Feldinhalte, ruft `openai/gpt-6-astra` über `responsesModel` mit striktem JSON-Schema (`value`, `unit`, `reason`) auf.
  - Inhalte sammeln über die vorhandene Zuordnung (`readAssignment`/`zoneAt`), gleiche Kürzung wie `summarizeZone`.
  - „Veraltet": Fingerabdruck aus IDs + Inhaltslängen der zugeordneten Karten; weicht er von `agentFingerprint` ab, zeigt `ZoneNode` den Hinweis.
  - Neuer Inspector-Reiter `AgentTab.tsx`; `InspectorTab` um `"agent"` erweitern, nur für `type === "zone"`.
- **Zone verbindbar:** in `toFlowNode` `connectable: true` für Zonen; `ZoneNode` bekommt ein Source-Handle rechts (nur sichtbar, wenn ein Auftrag gesetzt ist). `calc.ts` → `nodeValue` liest bei Zonen `agentResult`.
- **Rechner an der Verbindung:** Calculator-Button aus der Werkzeugleiste entfernen; `LabeledEdge` bekommt Klick-Popover (Label + „Rechnung anlegen") und `onEdgeDoubleClick` im Canvas, das ein vorhandenes `calc`-Modul dieser Kante fokussiert oder ein neues erzeugt und verbindet. Zuordnung über `metadata.fromEdge` auf dem calc-Modul.
- **Dashboard-Module:** neue Typen `metric`, `gauge`, `sheet` in `nodes.tsx` (`MetricNode`, `GaugeNode`, `SheetNode`), registriert in `nodeTypes`, `DEFAULT_SIZE`, kind-Mapping, `NODE_ACCENT`/`NODE_LABEL` und in `share.$token.tsx`.
  - `metric`: `metadata.value`, `unit`, `compare`.
  - `gauge`: `metadata.min`, `max`, `warn`, `danger`, `value`; SVG-Bogen, keine neue Abhängigkeit.
  - `sheet`: `metadata.rows` = `[{ name, value, formula }]`; Auswertung über das vorhandene `evalFormula` in `calc.ts`, erweitert um Zeilenbezüge (`B1`…) zusätzlich zu den Eingangsbuchstaben; Zyklenschutz über die vorhandene Tiefenbegrenzung.
