import { describe, expect, it } from "vitest";
import { redactPii, stricterMode } from "./pii";
import { TimeoutError, withTimeout, readBudget } from "./budget";

describe("redactPii", () => {
  it("maskiert alle Datenarten", () => {
    const r = redactPii(
      "Mail a.b@firma.de, IBAN DE89 3704 0044 0532 0130 00, Karte 4111 1111 1111 1111, Tel +49 170 1234567, IP 192.168.1.20, Key sk-abcdefghijklmnopqrstuvwx",
    );
    for (const raw of ["a.b@firma.de", "DE89", "4111", "1234567", "192.168", "sk-abc"]) expect(r.text).not.toContain(raw);
    expect(r.counts.EMAIL).toBe(1);
    expect(r.counts.IBAN).toBe(1);
    expect(r.counts.SCHLUESSEL).toBe(1);
  });
  it("gleiche Werte, gleicher Platzhalter", () => {
    const r = redactPii("x@y.de und nochmal x@y.de, dann z@y.de");
    expect(r.text).toBe("[EMAIL_1] und nochmal [EMAIL_1], dann [EMAIL_2]");
  });
  it("ungültige IBAN/Karte bleiben", () => {
    expect(redactPii("Auftrag 1234 5678 9012 3456").text).toContain("1234");
  });
  it("Modus secrets maskiert nur Schlüssel, off nichts", () => {
    expect(redactPii("x@y.de ghp_abcdefghijklmnopqrstuvwxyz12", "secrets").text).toBe("x@y.de [SCHLUESSEL_1]");
    expect(redactPii("x@y.de", "off").text).toBe("x@y.de");
    expect(stricterMode("off", "strict")).toBe("strict");
  });
});

describe("withTimeout", () => {
  it("bricht langsame Schritte ab und signalisiert", async () => {
    let aborted = false;
    await expect(
      withTimeout((s) => new Promise((r) => { s.addEventListener("abort", () => (aborted = true)); setTimeout(r, 500); }), 20),
    ).rejects.toBeInstanceOf(TimeoutError);
    expect(aborted).toBe(true);
  });
  it("liest Zeitlimit aus Einstellungen", () => {
    expect(readBudget({ timeoutSeconds: 7 }).timeoutSeconds).toBe(7);
    expect(readBudget({ timeoutSeconds: 9999 }).timeoutSeconds).toBe(300);
  });
});
