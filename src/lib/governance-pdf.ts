/** Governance-Nachweis als PDF – wird im Browser erzeugt, keine Daten verlassen das Gerät. */
import { LIFECYCLE_LABEL, RISK_HINT, RISK_LABEL, openReviews, type Governance } from "@/lib/governance";

export type Evidence = {
  title: string;
  privacy: string;
  governance: Governance;
  audit: { action: string; detail: string; at: string; actor: string }[];
};

const ACTION_LABEL: Record<string, string> = {
  governance_changed: "Einstufung geändert",
  privacy_changed: "Datenschutz geändert",
};
const PRIVACY_LABEL: Record<string, string> = {
  strict: "Streng (persönliche Daten und Geheimnisse maskiert)",
  secrets: "Nur Geheimnisse maskiert",
  off: "Aus",
};

export async function downloadGovernancePdf(e: Evidence) {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const W = 210;
  const M = 18;
  let y = 20;
  const ensure = (h: number) => {
    if (y + h > 280) {
      doc.addPage();
      y = 20;
    }
  };
  const text = (s: string, size = 10, bold = false, gap = 5) => {
    doc.setFont("helvetica", bold ? "bold" : "normal");
    doc.setFontSize(size);
    for (const line of doc.splitTextToSize(s, W - 2 * M) as string[]) {
      ensure(gap);
      doc.text(line, M, y);
      y += gap;
    }
  };
  const row = (k: string, v: string) => {
    ensure(6);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.text(k, M, y);
    doc.setFont("helvetica", "normal");
    const lines = doc.splitTextToSize(v || "–", W - 2 * M - 50) as string[];
    doc.text(lines, M + 50, y);
    y += Math.max(1, lines.length) * 5 + 1;
  };

  const g = e.governance;
  text("Governance-Nachweis", 18, true, 8);
  text(e.title, 12, false, 6);
  text(`Erstellt am ${new Date().toLocaleString("de-DE")} · scopebuilder`, 9, false, 5);
  y += 4;
  text("Einstufung", 12, true, 7);
  row("Risikostufe", `${RISK_LABEL[g.riskTier]} – ${RISK_HINT[g.riskTier]}`);
  row("Verwendungszweck", g.intendedUse);
  row("Freigabestatus", LIFECYCLE_LABEL[g.lifecycle]);
  row("Verantwortlich", g.owner);
  row("Kontakt", g.contact);
  row("Menschliche Freigabe", g.humanOversight ? "Ja" : "Nein");
  row("Datenschutz-Filter", PRIVACY_LABEL[e.privacy] ?? e.privacy);
  const open = openReviews(g);
  row("Offene Prüfungen", open.length ? open.join(", ") : "Keine");
  y += 4;
  text(`Protokoll (${e.audit.length} Einträge)`, 12, true, 7);
  if (!e.audit.length) text("Keine Einträge vorhanden.", 10);
  for (const a of e.audit) {
    ensure(12);
    text(
      `${new Date(a.at).toLocaleString("de-DE")} · ${ACTION_LABEL[a.action] ?? a.action} · ${a.actor}`,
      9,
      true,
      4.5,
    );
    if (a.detail) text(a.detail, 9, false, 4.5);
    y += 1.5;
  }
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setFont("helvetica", "normal");
    doc.text(`Seite ${i} von ${pages} · Kein Zertifikat, sondern Nachweis der Angaben im System.`, M, 290);
  }
  const safe = e.title.replace(/[^\w\-äöüÄÖÜß ]+/g, "").trim().replace(/\s+/g, "-") || "scope";
  doc.save(`governance-${safe}.pdf`);
}
