/**
 * KI-Governance eines Scopes (ISO/IEC 42001, EU AI Act).
 *
 * Die Angaben leben in `boards.rules.governance` und reisen als eigener
 * Abschnitt `governance` im Scope-Manifest mit. Alles ist optional und
 * vorbelegt, damit Prototyping nicht ausgebremst wird.
 */
import { z } from "zod";

export const RISK_TIERS = ["minimal", "limited", "high"] as const;
export type RiskTier = (typeof RISK_TIERS)[number];

export const LIFECYCLES = ["draft", "reviewed", "production"] as const;
export type Lifecycle = (typeof LIFECYCLES)[number];

export const GovernanceSchema = z.object({
  riskTier: z.enum(RISK_TIERS).default("minimal"),
  lifecycle: z.enum(LIFECYCLES).default("draft"),
  intendedUse: z.string().max(400).default(""),
  owner: z.string().max(200).default(""),
  contact: z.string().max(200).default(""),
  humanOversight: z.boolean().default(true),
});
export type Governance = z.infer<typeof GovernanceSchema>;

export const DEFAULT_GOVERNANCE: Governance = {
  riskTier: "minimal",
  lifecycle: "draft",
  intendedUse: "",
  owner: "",
  contact: "",
  humanOversight: true,
};

/** Governance aus den Scope-Regeln lesen; fehlende Angaben werden vorbelegt. */
export function readGovernance(rules: unknown): Governance {
  const raw =
    rules && typeof rules === "object" ? (rules as Record<string, unknown>)["governance"] : null;
  const parsed = GovernanceSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : { ...DEFAULT_GOVERNANCE };
}

/** Steht etwas drin, das vom Standard abweicht? */
export function hasGovernance(value: Governance): boolean {
  return (
    value.riskTier !== "minimal" ||
    value.lifecycle !== "draft" ||
    value.intendedUse.trim() !== "" ||
    value.owner.trim() !== "" ||
    value.contact.trim() !== "" ||
    value.humanOversight !== true
  );
}

export const RISK_LABEL: Record<RiskTier, string> = {
  minimal: "Minimal",
  limited: "Begrenzt",
  high: "Hochrisiko",
};

export const RISK_HINT: Record<RiskTier, string> = {
  minimal: "Interne Skizze oder Prototyp ohne Wirkung auf Personen.",
  limited: "Unterstützt Entscheidungen; Ergebnisse werden Menschen gezeigt und müssen gekennzeichnet sein.",
  high: "Wirkt auf Personen, Sicherheit oder Geld. Menschliche Freigabe und Nachweise sind Pflicht.",
};

export const LIFECYCLE_LABEL: Record<Lifecycle, string> = {
  draft: "Entwurf",
  reviewed: "Fachlich geprüft",
  production: "Freigegeben",
};

/** Hinweis für die fertige App (Transparenzpflicht ab „Begrenzt“). */
export function transparencyNote(value: Governance): string | null {
  if (value.riskTier === "minimal") return null;
  return value.riskTier === "high"
    ? "Enthält KI-unterstützte Auswertungen mit erhöhtem Risiko. Ergebnisse werden vor Wirkung menschlich geprüft (ISO 42001 / EU AI Act)."
    : "Enthält KI-unterstützte Auswertungen. Ergebnisse können fehlerhaft sein und sind zu prüfen (ISO 42001 / EU AI Act).";
}
