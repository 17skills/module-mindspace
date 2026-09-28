/**
 * Datenschutz-Filter vor KI-Aufrufen. Erkennt persönliche Daten und Geheimnisse
 * per Muster (mit Prüfziffern) und ersetzt sie durch stabile Platzhalter.
 * Platzhalter werden nie zurückgetauscht – die Werte verlassen den Server nicht.
 * Grenze: Namen und Adressen in Fließtext werden nicht zuverlässig erkannt.
 */
export type PrivacyMode = "strict" | "secrets" | "off";
export type PiiKind = "EMAIL" | "IBAN" | "KARTE" | "TELEFON" | "IP" | "SCHLUESSEL" | "STEUER_ID";

export function readPrivacyMode(rules: unknown): PrivacyMode {
  const v = rules && typeof rules === "object" ? (rules as Record<string, unknown>)["privacy"] : null;
  return v === "secrets" || v === "off" ? v : "strict";
}

/** Strengerer von zwei Modi – ein Baustein darf den Schutz nur verschärfen. */
export function stricterMode(a: PrivacyMode, b: PrivacyMode): PrivacyMode {
  const rank = { off: 0, secrets: 1, strict: 2 } as const;
  return rank[a] >= rank[b] ? a : b;
}

function luhn(digits: string): boolean {
  let sum = 0;
  let alt = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = Number(digits[i]);
    if (alt) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    alt = !alt;
  }
  return digits.length >= 13 && sum % 10 === 0;
}

function ibanValid(raw: string): boolean {
  const s = raw.replace(/\s+/g, "").toUpperCase();
  if (s.length < 15 || s.length > 34) return false;
  const moved = s.slice(4) + s.slice(0, 4);
  let rem = 0;
  for (const ch of moved) {
    const code = /[A-Z]/.test(ch) ? String(ch.charCodeAt(0) - 55) : ch;
    for (const d of code) rem = (rem * 10 + Number(d)) % 97;
  }
  return rem === 1;
}

type Detector = { kind: PiiKind; secret: boolean; re: RegExp; valid?: (m: string) => boolean };

// Reihenfolge zählt: Spezifisches vor Allgemeinem (Schlüssel vor Telefon usw.).
const DETECTORS: Detector[] = [
  {
    kind: "SCHLUESSEL",
    secret: true,
    re: /\b(?:sk-[A-Za-z0-9_-]{16,}|sk_(?:live|test)_[A-Za-z0-9]{16,}|sbk_[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{30,}|xox[baprs]-[A-Za-z0-9-]{10,}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})/g,
  },
  { kind: "EMAIL", secret: false, re: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g },
  {
    kind: "IBAN",
    secret: false,
    re: /\b[A-Z]{2}\d{2}(?:\s?[A-Z0-9]{4}){2,7}(?:\s?[A-Z0-9]{1,3})?\b/g,
    valid: ibanValid,
  },
  {
    kind: "KARTE",
    secret: false,
    re: /\b(?:\d[ -]?){13,19}\b/g,
    valid: (m) => luhn(m.replace(/\D/g, "")),
  },
  { kind: "IP", secret: false, re: /\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b/g },
  { kind: "STEUER_ID", secret: false, re: /\b(?:DE\d{9}|\d{2}\s?\d{3}\s?\d{3}\s?\d{3})\b/g },
  {
    kind: "TELEFON",
    secret: false,
    re: /(?:\+\d{1,3}[\s/-]?|\b0)\d{2,5}[\s/-]?\d{3,}(?:[\s/-]?\d{2,})?\b/g,
    valid: (m) => m.replace(/\D/g, "").length >= 8,
  },
];

export type Redaction = { text: string; counts: Partial<Record<PiiKind, number>> };

/** Ersetzt erkannte Werte; gleiche Werte bekommen denselben Platzhalter. */
export function redactPii(text: string, mode: PrivacyMode = "strict"): Redaction {
  if (mode === "off" || !text) return { text, counts: {} };
  const seen = new Map<string, string>();
  const perKind: Partial<Record<PiiKind, number>> = {};
  let out = text;
  for (const d of DETECTORS) {
    if (mode === "secrets" && !d.secret) continue;
    out = out.replace(d.re, (match) => {
      if (/^\[[A-Z_]+_\d+\]$/.test(match)) return match;
      if (d.valid && !d.valid(match)) return match;
      const key = `${d.kind}:${match.replace(/\s+/g, "")}`;
      let ph = seen.get(key);
      if (!ph) {
        perKind[d.kind] = (perKind[d.kind] ?? 0) + 1;
        ph = `[${d.kind}_${perKind[d.kind]}]`;
        seen.set(key, ph);
      }
      return ph;
    });
  }
  return { text: out, counts: perKind };
}

/** Zusammenfassung für das Protokoll – nie die Werte selbst. */
export function redactionSummary(counts: Partial<Record<PiiKind, number>>): string {
  const parts = Object.entries(counts).map(([k, n]) => `${k}×${n}`);
  return parts.length ? `Maskiert: ${parts.join(", ")}` : "";
}
