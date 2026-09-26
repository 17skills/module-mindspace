import { describe, expect, it } from "vitest";
import { expiresAt, retentionDays, seesAllRuns, sha256Hex } from "./runs";
import { guestView } from "./guest-view";

describe("Durchlauf-Ablage", () => {
  it("nimmt nur erlaubte Löschfristen, sonst 30 Tage", () => {
    expect(retentionDays({ retentionDays: 7 })).toBe(7);
    expect(retentionDays({ retentionDays: 90 })).toBe(90);
    expect(retentionDays({ retentionDays: 3650 })).toBe(30);
    expect(retentionDays(null)).toBe(30);
  });

  it("berechnet das Ablaufdatum", () => {
    expect(expiresAt(7, 0)).toBe(new Date(7 * 86_400_000).toISOString());
  });

  it("zeigt fremde Durchläufe nur Bearbeitern und Inhabern", () => {
    expect(seesAllRuns("owner")).toBe(true);
    expect(seesAllRuns("editor")).toBe(true);
    expect(seesAllRuns("viewer")).toBe(false);
    expect(seesAllRuns("commenter")).toBe(false);
    expect(seesAllRuns(null)).toBe(false);
  });

  it("bildet stabile Prüfsummen", async () => {
    expect(await sha256Hex("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("gibt Gästen keine Durchläufe oder Eingabedateien heraus", () => {
    const view = guestView(
      [
        {
          id: "aus",
          parent_id: null,
          metadata: { runs: [{ id: "r1" }], inputPath: "runs/b/r1/foto.jpg", retentionDays: 30 },
        },
      ],
      [],
      new Set(),
    );
    const json = JSON.stringify(view);
    expect(json).not.toContain("r1");
    expect(json).not.toContain("foto.jpg");
    expect(json).toContain("retentionDays");
  });
});
