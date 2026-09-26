/**
 * Durchlauf-Ablage: jede Eingabe an einem Ergebnis-Modul wird einzeln abgelegt,
 * statt die Karte auf dem Canvas zu überschreiben.
 */
export type RunStatus = "running" | "done" | "failed";

export const RUN_STATUS_LABEL: Record<RunStatus, string> = {
  running: "läuft",
  done: "fertig",
  failed: "fehlgeschlagen",
};

export const RETENTION_CHOICES = [7, 30, 90] as const;
export const DEFAULT_RETENTION = 30;

/** Löschfrist in Tagen aus den Modul-Einstellungen, nur erlaubte Werte. */
export function retentionDays(metadata: Record<string, unknown> | null | undefined): number {
  const value = Number((metadata ?? {})["retentionDays"]);
  return (RETENTION_CHOICES as readonly number[]).includes(value) ? value : DEFAULT_RETENTION;
}

export function expiresAt(days: number, from: number = Date.now()): string {
  return new Date(from + days * 86_400_000).toISOString();
}

/** Wer darf alle Durchläufe sehen? Bearbeiter und Inhaber – alle anderen nur eigene. */
export function seesAllRuns(role: string | null | undefined): boolean {
  return role === "owner" || role === "editor";
}

export async function sha256Hex(value: string | ArrayBuffer): Promise<string> {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : new Uint8Array(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}
