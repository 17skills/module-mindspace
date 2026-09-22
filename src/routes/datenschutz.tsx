import { createFileRoute, Link } from "@tanstack/react-router";
import { PROCESSING_PURPOSES } from "@/lib/settings";

export const Route = createFileRoute("/datenschutz")({
  head: () => ({
    meta: [
      { title: "Datenschutzerklärung — scopebuilder" },
      {
        name: "description",
        content:
          "Welche Daten scopebuilder verarbeitet, zu welchem Zweck, wie lange sie gespeichert werden und welche Rechte du hast.",
      },
      { property: "og:title", content: "Datenschutzerklärung — scopebuilder" },
      {
        property: "og:description",
        content: "Verarbeitungszwecke, Speicherdauer, eingesetzte Dienste und deine Rechte.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: PrivacyPolicy,
});

function PrivacyPolicy() {
  return (
    <LegalPage title="Datenschutzerklärung">
      <p>
        scopebuilder verarbeitet personenbezogene Daten nach der Datenschutz-Grundverordnung
        (DSGVO). Diese Seite erklärt in klarer Sprache, welche Daten anfallen, warum und wie lange.
      </p>

      <h2>Verantwortliche Stelle</h2>
      <p>
        [Firmenname], [Straße und Hausnummer], [PLZ Ort], E-Mail: [datenschutz@beispiel.de].
        Diese Angaben sind Platzhalter und müssen vor der Veröffentlichung durch die echten
        Kontaktdaten ersetzt werden.
      </p>

      <h2>Verarbeitungszwecke und Dienste</h2>
      <ul>
        {PROCESSING_PURPOSES.map((item) => (
          <li key={item.service}>
            <strong>{item.service}</strong> — Daten: {item.data}. Zweck: {item.purpose}.
          </li>
        ))}
      </ul>

      <h2>Rechtsgrundlagen</h2>
      <p>
        Konto und Inhalte verarbeiten wir zur Erfüllung des Nutzungsvertrags (Art. 6 Abs. 1 lit. b
        DSGVO). KI-Auswertung und optionale E-Mails erfolgen nur mit deiner Einwilligung (Art. 6
        Abs. 1 lit. a DSGVO), die du jederzeit im Konto widerrufen kannst.
      </p>

      <h2>Speicherdauer</h2>
      <p>
        Kontodaten und Inhalte bleiben gespeichert, solange dein Konto besteht. Nach einer
        Löschanfrage werden sie nach sieben Tagen Widerrufsfrist endgültig entfernt.
        Sicherheitsprotokolle werden nach 90 Tagen automatisch gelöscht und enthalten weder
        IP-Adresse noch Standort.
      </p>

      <h2>Deine Rechte</h2>
      <p>
        Du hast das Recht auf Auskunft, Berichtigung, Löschung, Einschränkung, Datenübertragbarkeit
        und Widerspruch sowie das Recht auf Beschwerde bei einer Aufsichtsbehörde. Auskunft, Export
        und Löschung erledigst du direkt im Bereich Konto → Datenschutz.
      </p>

      <h2>Künstliche Intelligenz</h2>
      <p>
        Von KI erzeugte Bewertungen und Vorschläge sind als maschinell erzeugt gekennzeichnet. Sie
        sind Entscheidungshilfen, keine automatisierten Einzelentscheidungen im Sinne von Art. 22
        DSGVO; die fachliche Prüfung und Freigabe liegt immer bei einem Menschen.
      </p>
    </LegalPage>
  );
}

export function LegalPage({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-background">
      <div className="mx-auto max-w-3xl px-6 py-14">
        <Link to="/" className="text-sm text-muted-foreground underline-offset-4 hover:underline">
          ← scopebuilder
        </Link>
        <h1 className="mt-6 font-display text-3xl font-semibold tracking-tight text-brand-navy">
          {title}
        </h1>
        <div className="mt-8 space-y-4 text-sm leading-relaxed [&_h2]:mt-8 [&_h2]:font-display [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:text-brand-navy [&_li]:mt-1.5 [&_ul]:list-disc [&_ul]:pl-5">
          {children}
        </div>
      </div>
    </main>
  );
}
