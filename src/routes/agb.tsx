import { createFileRoute } from "@tanstack/react-router";
import { LegalPage } from "./datenschutz";

export const Route = createFileRoute("/agb")({
  head: () => ({
    meta: [
      { title: "Nutzungsbedingungen — scopebuilder" },
      {
        name: "description",
        content: "Bedingungen für die Nutzung von scopebuilder: Konto, Inhalte, KI-Ergebnisse, Haftung.",
      },
      { property: "og:title", content: "Nutzungsbedingungen — scopebuilder" },
      {
        property: "og:description",
        content: "Bedingungen für die Nutzung von scopebuilder: Konto, Inhalte, KI-Ergebnisse, Haftung.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => (
    <LegalPage title="Nutzungsbedingungen">
      <p>
        Diese Bedingungen sind ein Entwurf mit Platzhaltern und vor der Veröffentlichung
        rechtlich zu prüfen.
      </p>
      <h2>1. Konto</h2>
      <p>
        Für die Nutzung ist ein persönliches Konto nötig. Zugangsdaten und App-Schlüssel sind
        vertraulich zu behandeln; bei Verdacht auf Missbrauch ist der Schlüssel im Konto sofort zu
        erneuern.
      </p>
      <h2>2. Inhalte</h2>
      <p>
        Die von dir eingestellten Inhalte bleiben deine. Du sicherst zu, dass du die nötigen
        Rechte daran hast und keine fremden personenbezogenen Daten ohne Rechtsgrundlage
        einstellst.
      </p>
      <h2>3. KI-Ergebnisse</h2>
      <p>
        Bewertungen, Vorschläge und Berichte aus der KI-Auswertung sind Entscheidungshilfen. Sie
        sind vor einer fachlichen oder sicherheitsrelevanten Entscheidung von einer
        verantwortlichen Person zu prüfen.
      </p>
      <h2>4. Verfügbarkeit</h2>
      <p>
        Wir bemühen uns um einen unterbrechungsfreien Betrieb, schulden aber keine bestimmte
        Verfügbarkeit. Wartungsarbeiten werden nach Möglichkeit angekündigt.
      </p>
      <h2>5. Haftung</h2>
      <p>
        Es gilt die gesetzliche Haftung. Für leichte Fahrlässigkeit haften wir nur bei Verletzung
        wesentlicher Vertragspflichten und begrenzt auf den vertragstypischen Schaden.
      </p>
      <h2>6. Kündigung</h2>
      <p>
        Du kannst dein Konto jederzeit im Bereich Konto → Datenschutz löschen. Vorher lässt sich
        ein vollständiger Datenexport herunterladen.
      </p>
    </LegalPage>
  ),
});
