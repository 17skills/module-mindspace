/**
 * Signal-Bus.
 *
 * Jede Verbindung auf dem Canvas ist ein typisierter Kanal, der seinen
 * Zustand selbst errechnet: Datenqualität der Quelle + Typ-Verträglichkeit
 * der Ports + Regelbefunde der Ontologie.
 *
 * Invarianten:
 *  - der Bus warnt, er blockiert nie (Signalgeber, kein Vollstrecker)
 *  - jeder Zustand trägt eine Klartext-Erklärung mit Ursache und nächstem Schritt
 *  - Unvollständigkeit ist ein eigener, sichtbarer Zustand — kein Fehler
 */
import {
  envelopeSignal,
  primaryFacet,
  type FacetName,
  type SourceEnvelope,
} from "@/lib/runtime/source-protocol";
import {
  evaluateOntology,
  summarizeFindings,
  type Ontology,
  type RuleFinding,
} from "@/lib/runtime/rule-ontology";

/**
 * grün  = geprüfter, gültiger Fluss
 * gelb  = gültig, aber lückenhaft oder grenzwertig
 * rot   = Regelverstoß oder unverträgliche Typen
 * grau  = Referenz ohne Datenfluss / noch nichts angekommen
 */
export type SignalStatus = "ok" | "warn" | "violation" | "idle";

export interface SignalExplanation {
  /** Was ist der Fall. */
  headline: string;
  /** Warum ist es so. */
  cause: string | null;
  /** Was kann der Mensch tun. */
  remedy: string | null;
}

export interface Signal {
  status: SignalStatus;
  /** Kurzwert für die Pille am Kabel, z. B. "128 Zeilen" oder "68.000 EUR". */
  display: string;
  confidence: number;
  completeness: number;
  findings: RuleFinding[];
  explanation: SignalExplanation;
  facet: FacetName | null;
}

const RANK: Record<SignalStatus, number> = { violation: 3, warn: 2, idle: 1, ok: 0 };

export function worstStatus(statuses: SignalStatus[]): SignalStatus {
  return statuses.reduce<SignalStatus>(
    (worst, status) => (RANK[status] > RANK[worst] ? status : worst),
    "ok",
  );
}

/** Farbrolle für die Oberfläche — die Komponenten mappen auf Design-Tokens. */
export function signalTone(status: SignalStatus): "positive" | "caution" | "critical" | "muted" {
  if (status === "ok") return "positive";
  if (status === "warn") return "caution";
  if (status === "violation") return "critical";
  return "muted";
}

/** Prüft, ob ein Ausgang zu einem Eingang passt. "any" akzeptiert alles. */
export type PortFacet = FacetName | "any";

export function portsCompatible(from: FacetName | null, accepts: PortFacet[]): boolean {
  if (!from) return false;
  return accepts.includes("any") || accepts.includes(from);
}

function facetLabel(facet: FacetName | null): string {
  switch (facet) {
    case "dataset":
      return "Tabelle";
    case "entity":
      return "Struktur";
    case "document":
      return "Text";
    case "evidence":
      return "Beleg";
    default:
      return "keine Daten";
  }
}

function displayOf(envelope: SourceEnvelope): string {
  const { dataset, entity, document, evidence } = envelope.facets;
  if (dataset) return `${dataset.rowCount} Zeilen`;
  if (entity) return `${entity.schema.length} Felder`;
  if (document) return `${document.wordCount} Wörter`;
  if (evidence) return `${Math.round(evidence.byteSize / 1024)} KB`;
  return "leer";
}

export interface SignalInput {
  envelope: SourceEnvelope | null;
  /** Welche Facetten das Zielmodul verarbeiten kann. */
  accepts?: PortFacet[];
  /** Optionale Leitplanken; ohne Ontologie bleibt der Bus rein datengetrieben. */
  ontology?: Ontology | null;
}

/** Errechnet den Zustand einer Verbindung. */
export function evaluateSignal(input: SignalInput): Signal {
  const { envelope, accepts = ["any"], ontology = null } = input;

  if (!envelope) {
    return {
      status: "idle",
      display: "—",
      confidence: 0,
      completeness: 0,
      findings: [],
      facet: null,
      explanation: {
        headline: "Kein Datenfluss",
        cause: "An diesem Eingang ist noch keine Quelle angeschlossen.",
        remedy: "Verbinde eine Quelle oder ein Rechenmodul mit diesem Eingang.",
      },
    };
  }

  const facet = primaryFacet(envelope);
  const { completeness, confidence, anomalies } = envelope.quality;
  const display = displayOf(envelope);

  if (!facet) {
    return {
      status: "violation",
      display,
      confidence,
      completeness,
      findings: [],
      facet: null,
      explanation: {
        headline: "Quelle nicht lesbar",
        cause: anomalies[0] ?? `„${envelope.meta.sourceName}“ enthält keine auswertbaren Inhalte.`,
        remedy: "Datei erneut ablegen oder ein anderes Format verwenden.",
      },
    };
  }

  if (!portsCompatible(facet, accepts)) {
    return {
      status: "violation",
      display,
      confidence,
      completeness,
      findings: [],
      facet,
      explanation: {
        headline: "Typen passen nicht zusammen",
        cause: `Die Quelle liefert „${facetLabel(facet)}“, das Ziel erwartet ${accepts
          .map((a) => (a === "any" ? "beliebig" : facetLabel(a)))
          .join(" oder ")}.`,
        remedy: "Ein Umwandlungs-Modul dazwischen setzen oder einen passenden Eingang wählen.",
      },
    };
  }

  const evaluation = ontology ? evaluateOntology(ontology, envelope) : null;
  const findings = evaluation ? summarizeFindings(evaluation.findings) : [];
  const quality = envelopeSignal(envelope);

  if (evaluation?.violations) {
    const first = findings.find((f) => f.status === "violation");
    return {
      status: "violation",
      display,
      confidence,
      completeness,
      findings,
      facet,
      explanation: {
        headline: "Regelverstoß erkannt",
        cause: first?.message ?? "Eine hinterlegte Leitplanke wird verletzt.",
        remedy: first?.requires ?? "Wert prüfen oder Freigabe auf der nächsthöheren Ebene einholen.",
      },
    };
  }

  if (evaluation?.warnings) {
    const first = findings.find((f) => f.status === "warn");
    return {
      status: "warn",
      display,
      confidence,
      completeness,
      findings,
      facet,
      explanation: {
        headline: "Grenzwertig",
        cause: first?.message ?? "Ein Wert liegt nahe an einer Leitplanke.",
        remedy: first?.requires ?? "Wert gegenprüfen, bevor daraus ein Beschluss wird.",
      },
    };
  }

  if (quality === "ok" && !evaluation?.unknowns) {
    return {
      status: "ok",
      display,
      confidence,
      completeness,
      findings,
      facet,
      explanation: {
        headline: "Gültiger Datenfluss",
        cause: `${facetLabel(facet)} aus „${envelope.meta.sourceName}“, vollständig gelesen.`,
        remedy: null,
      },
    };
  }

  const missingRule = findings.find((f) => f.status === "unknown");
  return {
    status: "warn",
    display,
    confidence,
    completeness,
    findings,
    facet,
    explanation: {
      headline: "Daten mit Lücken",
      cause:
        anomalies[0] ??
        missingRule?.message ??
        `Vollständigkeit ${Math.round(completeness * 100)} %, Konfidenz ${Math.round(confidence * 100)} %.`,
      remedy: "Ergebnis mit ausgewiesener Unsicherheit nutzen oder fehlende Angaben nachreichen.",
    },
  };
}

/** Fasst mehrere Eingangssignale eines Moduls zu einem Gesamtzustand zusammen. */
export function aggregateSignals(signals: Signal[]): Signal {
  if (!signals.length) {
    return evaluateSignal({ envelope: null });
  }
  const status = worstStatus(signals.map((signal) => signal.status));
  const leading = signals.find((signal) => signal.status === status) ?? signals[0]!;
  const confidence = Math.min(...signals.map((signal) => signal.confidence));
  const completeness = Math.min(...signals.map((signal) => signal.completeness));
  return {
    ...leading,
    status,
    confidence: Math.round(confidence * 100) / 100,
    completeness: Math.round(completeness * 100) / 100,
    findings: signals.flatMap((signal) => signal.findings),
    display: signals.length === 1 ? leading.display : `${signals.length} Eingänge`,
  };
}
