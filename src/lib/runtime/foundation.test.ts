import { describe, expect, it } from "vitest";
import { ingestText } from "@/lib/runtime/ingestion";
import {
  evaluateOntology,
  evaluateRule,
  ontologyFromEnvelope,
  parseOntology,
  summarizeFindings,
  type Ontology,
} from "@/lib/runtime/rule-ontology";
import {
  aggregateSignals,
  evaluateSignal,
  portsCompatible,
  signalTone,
  worstStatus,
} from "@/lib/runtime/signal-engine";

const budgetOntology: Ontology = parseOntology({
  id: "onto_budget",
  name: "Zeichnungsbefugnis",
  depth: "guarded",
  rules: [
    {
      id: "r_limit",
      label: "Budgetgrenze Betriebsleiter",
      subject: "Betrag",
      operator: "lte",
      value: 50000,
      unit: "EUR",
      severity: "violation",
      reference: "Unterschriftenrichtlinie 2.1",
      requires: "Vorstandsbeschluss (4-Augen-Prinzip)",
    },
    {
      id: "r_status",
      label: "Zulässiger Status",
      subject: "Status",
      operator: "oneOf",
      value: ["offen", "geprüft", "freigegeben"],
      severity: "warn",
    },
  ],
}).ontology!;

describe("rule-ontology", () => {
  it("meldet Schemafehler statt still zu scheitern", () => {
    const result = parseOntology({ name: "ohne id" });
    expect(result.ontology).toBeNull();
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("importiert Regeln aus einer YAML-Quelle", () => {
    const envelope = ingestText(
      ["id: onto_reise", "name: Reiserichtlinie", "rules:", "  - id: r1", "    label: Tageslimit", "    subject: Kosten", "    operator: lte", "    value: 200"].join("\n"),
      { sourceName: "reise.yaml" },
    );
    const { ontology, errors } = ontologyFromEnvelope(envelope);
    expect(errors).toEqual([]);
    expect(ontology?.rules[0]?.label).toBe("Tageslimit");
  });

  it("erklärt eine Verletzung im Klartext mit Grundlage und Erfordernis", () => {
    const finding = evaluateRule(budgetOntology.rules[0]!, 68000);
    expect(finding.status).toBe("violation");
    expect(finding.message).toContain("68.000 EUR");
    expect(finding.message).toContain("Vorstandsbeschluss");
    expect(finding.message).toContain("Unterschriftenrichtlinie 2.1");
  });

  it("bewertet fehlende Werte als unbekannt, nie als bestanden", () => {
    expect(evaluateRule(budgetOntology.rules[0]!, null).status).toBe("unknown");
    expect(evaluateRule(budgetOntology.rules[0]!, "n/a").status).toBe("unknown");
  });

  it("prüft Tabellen zeilenweise und verdichtet auf den schlimmsten Fall", () => {
    const envelope = ingestText("Betrag;Status\n12000;offen\n68000;offen\n", {
      sourceName: "massnahmen.csv",
    });
    const evaluation = evaluateOntology(budgetOntology, envelope);
    expect(evaluation.violations).toBe(1);
    const summary = summarizeFindings(evaluation.findings);
    expect(summary[0]?.status).toBe("violation");
    expect(summary[0]?.row).toBe(3);
  });
});

describe("signal-engine", () => {
  it("zeigt Grau ohne angeschlossene Quelle", () => {
    const signal = evaluateSignal({ envelope: null });
    expect(signal.status).toBe("idle");
    expect(signalTone(signal.status)).toBe("muted");
  });

  it("zeigt Grün bei sauberen Daten ohne Regelkonflikt", () => {
    const envelope = ingestText("Betrag;Status\n12000;offen\n9000;geprüft\n", {
      sourceName: "ok.csv",
    });
    const signal = evaluateSignal({ envelope, ontology: budgetOntology });
    expect(signal.status).toBe("ok");
    expect(signal.display).toBe("2 Zeilen");
  });

  it("zeigt Rot mit Ursache und Lösungshinweis bei Regelverstoß", () => {
    const envelope = ingestText("Betrag;Status\n68000;offen\n", { sourceName: "risiko.csv" });
    const signal = evaluateSignal({ envelope, ontology: budgetOntology });
    expect(signal.status).toBe("violation");
    expect(signal.explanation.cause).toContain("68.000 EUR");
    expect(signal.explanation.remedy).toContain("Vorstandsbeschluss");
  });

  it("zeigt Rot bei unverträglichen Typen", () => {
    const envelope = ingestText("Nur ein Fließtext ohne Tabelle.", { sourceName: "notiz.txt" });
    const signal = evaluateSignal({ envelope, accepts: ["dataset"] });
    expect(signal.status).toBe("violation");
    expect(signal.explanation.headline).toBe("Typen passen nicht zusammen");
  });

  it("wertet Lücken als Warnung, nicht als Fehler", () => {
    const envelope = ingestText("Betrag;Status\n12000;\n;\n", { sourceName: "lueckig.csv" });
    const signal = evaluateSignal({ envelope });
    expect(signal.status).toBe("warn");
    expect(signal.completeness).toBeLessThan(1);
  });

  it("verdichtet mehrere Eingänge auf den schlimmsten Zustand", () => {
    const ok = evaluateSignal({
      envelope: ingestText("Betrag;Status\n1000;offen\n", { sourceName: "a.csv" }),
      ontology: budgetOntology,
    });
    const bad = evaluateSignal({
      envelope: ingestText("Betrag;Status\n90000;offen\n", { sourceName: "b.csv" }),
      ontology: budgetOntology,
    });
    expect(worstStatus([ok.status, bad.status])).toBe("violation");
    expect(aggregateSignals([ok, bad]).status).toBe("violation");
    expect(portsCompatible("dataset", ["any"])).toBe(true);
    expect(portsCompatible("document", ["dataset"])).toBe(false);
  });
});
