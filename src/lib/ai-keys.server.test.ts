import { describe, expect, it } from "vitest";
import { decryptKey, encryptKey } from "@/lib/ai-keys.server";

describe("BYOK-Schlüssel-Verschlüsselung", () => {
  it("rundet Klartext-Schlüssel verschlüsselt herum", () => {
    process.env["AI_KEY_ENCRYPTION_SECRET"] = "test-secret-mit-mindestens-32-zeichen-länge!!";
    const keys = [
      "sk-proj-abc123def456ghi789",
      "sk-ant-api03-kurz",
      "AIzaSyA1234567890abcdefghijklmnopqrstu",
      "sk-or-v1-0123456789abcdef0123456789abcdef",
    ];
    for (const plain of keys) {
      const packed = encryptKey(plain);
      expect(packed).not.toContain(plain);
      expect(packed).not.toContain(plain.slice(-4));
      expect(decryptKey(packed)).toBe(plain);
    }
  });

  it("nutzt ein frisches IV, gleicher Klartext ergibt unterschiedliche Ciphertexte", () => {
    process.env["AI_KEY_ENCRYPTION_SECRET"] = "test-secret-mit-mindestens-32-zeichen-länge!!";
    const packedA = encryptKey("sk-ein-ganz-normaler-key");
    const packedB = encryptKey("sk-ein-ganz-normaler-key");
    expect(packedA).not.toBe(packedB);
    expect(decryptKey(packedA)).toBe(decryptKey(packedB));
  });

  it("wirft bei manipuliertem Geheimtext", () => {
    process.env["AI_KEY_ENCRYPTION_SECRET"] = "test-secret-mit-mindestens-32-zeichen-länge!!";
    const packed = encryptKey("sk-manipulierter-key");
    const raw = Buffer.from(packed, "base64");
    raw[raw.length - 1] ^= 0xff;
    const manipulated = Buffer.from(raw).toString("base64");
    expect(() => decryptKey(manipulated)).toThrow();
  });

  it("wirft ohne Verschlüsselungs-Geheimnis", () => {
    const before = process.env["AI_KEY_ENCRYPTION_SECRET"];
    delete process.env["AI_KEY_ENCRYPTION_SECRET"];
    expect(() => encryptKey("sk-ohne-secret")).toThrow("AI_KEY_ENCRYPTION_SECRET fehlt");
    if (before !== undefined) process.env["AI_KEY_ENCRYPTION_SECRET"] = before;
  });
});
