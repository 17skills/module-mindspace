import { createFileRoute } from "@tanstack/react-router";
import { LegalPage } from "./datenschutz";

export const Route = createFileRoute("/impressum")({
  head: () => ({
    meta: [
      { title: "Impressum — scopebuilder" },
      { name: "description", content: "Anbieterkennzeichnung und Kontaktdaten von scopebuilder." },
      { property: "og:title", content: "Impressum — scopebuilder" },
      {
        property: "og:description",
        content: "Anbieterkennzeichnung und Kontaktdaten von scopebuilder.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => (
    <LegalPage title="Impressum">
      <p>Angaben gemäß § 5 DDG. Alle eckigen Klammern sind Platzhalter und noch zu ersetzen.</p>
      <h2>Anbieter</h2>
      <p>
        [Firmenname]
        <br />
        [Straße und Hausnummer]
        <br />
        [PLZ Ort], [Land]
      </p>
      <h2>Kontakt</h2>
      <p>
        E-Mail: [kontakt@beispiel.de]
        <br />
        Telefon: [+49 …]
      </p>
      <h2>Vertretungsberechtigt</h2>
      <p>[Name der vertretungsberechtigten Person]</p>
      <h2>Register und Umsatzsteuer</h2>
      <p>
        Registergericht: [Amtsgericht], Registernummer: [HRB …]
        <br />
        Umsatzsteuer-Identifikationsnummer: [DE …]
      </p>
    </LegalPage>
  ),
});
