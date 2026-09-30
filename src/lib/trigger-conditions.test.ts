import { describe, expect, it } from "vitest";
import { evaluateTrigger, parseConditions, readPath, toNumber } from "@/lib/trigger-conditions";

describe("readPath", () => {
  it("liest verschachtelte Felder und Listenplätze", () => {
    const data = { current: { wind: [{ speed: 82 }] } };
    expect(readPath(data, "current.wind.0.speed")).toBe(82);
    expect(readPath(data, "current.fehlt")).toBeUndefined();
  });
});

describe("toNumber", () => {
  it("erkennt Zahlen in Text", () => {
    expect(toNumber("82 km/h")).toBe(82);
    expect(toNumber("1.234,5")).toBe(1234.5);
    expect(toNumber("keine")).toBeNull();
  });
});

describe("evaluateTrigger", () => {
  const payload = { wind: 82, status: "CRITICAL alarm", price: 110 };

  it("startet ohne Bedingung", () => {
    expect(evaluateTrigger([], payload).fired).toBe(true);
  });

  it("prüft Zahlengrenzen", () => {
    expect(evaluateTrigger([{ path: "wind", op: "gt", value: 75 }], payload).fired).toBe(true);
    expect(evaluateTrigger([{ path: "wind", op: "gt", value: 90 }], payload).fired).toBe(false);
  });

  it("prüft Text", () => {
    expect(evaluateTrigger([{ path: "status", op: "contains", value: "critical" }], payload).fired).toBe(true);
    expect(evaluateTrigger([{ path: "status", op: "contains", value: "ok" }], payload).fired).toBe(false);
  });

  it("erkennt Änderungen gegenüber dem letzten Lauf", () => {
    const rule = [{ path: "wind", op: "changed" as const }];
    expect(evaluateTrigger(rule, payload, { wind: 82 }).fired).toBe(false);
    expect(evaluateTrigger(rule, payload, { wind: 40 }).fired).toBe(true);
  });

  it("rechnet absolute und prozentuale Abweichung", () => {
    expect(evaluateTrigger([{ path: "price", op: "delta_abs", value: 5 }], payload, { price: 100 }).fired).toBe(true);
    expect(evaluateTrigger([{ path: "price", op: "delta_pct", value: 20 }], payload, { price: 100 }).fired).toBe(false);
    expect(evaluateTrigger([{ path: "price", op: "delta_pct", value: 5 }], payload, { price: 100 }).fired).toBe(true);
  });

  it("wartet beim ersten Lauf auf einen Vergleichswert", () => {
    const out = evaluateTrigger([{ path: "price", op: "delta_pct", value: 5 }], payload, {});
    expect(out.fired).toBe(false);
    expect(out.results[0]?.reason).toContain("Vergleichswert");
  });

  it("unterscheidet eine und alle Bedingungen", () => {
    const rules = [
      { path: "wind", op: "gt" as const, value: 75 },
      { path: "price", op: "gt" as const, value: 500 },
    ];
    expect(evaluateTrigger(rules, payload, {}, "any").fired).toBe(true);
    expect(evaluateTrigger(rules, payload, {}, "all").fired).toBe(false);
  });

  it("merkt die neuen Werte für den nächsten Vergleich", () => {
    const out = evaluateTrigger([{ path: "wind", op: "changed" }], payload, { wind: 10 });
    expect(out.nextValues["wind"]).toBe(82);
  });
});

describe("parseConditions", () => {
  it("wirft unbekannte Regeln weg", () => {
    const parsed = parseConditions([
      { path: "a", op: "gt", value: 1 },
      { path: "", op: "gt" },
      { path: "b", op: "hack" },
    ]);
    expect(parsed).toEqual([{ path: "a", op: "gt", value: 1 }]);
  });
});

import { formatLogReason, parseExcludePaths } from "./trigger-conditions";
describe("formatLogReason", () => {
  const ev = evaluateTrigger(
    [{ path: "wind", op: "gt", value: 50 }, { path: "user.email", op: "exists" }],
    { wind: 82, user: { email: "a@b.de" } },
    {},
  );
  it("schwärzt Werte standardmäßig", () => {
    const r = formatLogReason(ev);
    expect(r).not.toContain("82");
    expect(r).not.toContain("a@b.de");
    expect(r).toContain("•••");
  });
  it("zeigt Werte nur bei Freigabe und blendet sensible Pfade aus", () => {
    const r = formatLogReason(ev, { showValues: true, exclude: parseExcludePaths("user") });
    expect(r).toContain("82");
    expect(r).not.toContain("email");
    expect(r).toContain("1 Regel(n) ausgeblendet");
  });
});

import { matchesExclude, redactPayload } from "./trigger-conditions";
describe("matchesExclude", () => {
  it("versteht Wildcards, Listenplätze und Unterfelder", () => {
    expect(matchesExclude("users[3].email", "users[*].email")).toBe(true);
    expect(matchesExclude("users.3.email", "users[*].email")).toBe(true);
    expect(matchesExclude("users[3].name", "users[*].email")).toBe(false);
    expect(matchesExclude("users[1].email", "users[0].email")).toBe(false);
    expect(matchesExclude("a.b.c.token", "**.token")).toBe(true);
    expect(matchesExclude("kunde.adresse.plz", "kunde.adresse")).toBe(true);
    expect(matchesExclude("kundenummer", "kunde")).toBe(false);
  });
  it("schwärzt Beispiel-JSON", () => {
    const out = redactPayload({ users: [{ email: "a@b.de", n: 1 }, { email: "c@d.de", n: 2 }] }, ["users[*].email"]);
    expect(JSON.stringify(out)).not.toContain("@");
    expect(JSON.stringify(out)).toContain('"n":2');
  });
});

import { listPaths, validateExcludePattern } from "./trigger-conditions";
describe("validateExcludePattern", () => {
  it("erklärt Fehler", () => {
    expect(validateExcludePattern("users[*].email")).toBeNull();
    expect(validateExcludePattern("**.token")).toBeNull();
    expect(validateExcludePattern("users[x].email")).toContain("[x]");
    expect(validateExcludePattern("users[0.email")).toContain("Klammer");
    expect(validateExcludePattern("a..b")).toContain("Punkt");
    expect(validateExcludePattern("em*il")).toContain("*");
  });
  it("listet Pfade", () => {
    expect(listPaths({ a: [{ b: 1 }] })).toEqual(["a", "a[0]", "a[0].b"]);
  });
});
