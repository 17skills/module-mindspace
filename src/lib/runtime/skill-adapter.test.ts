import { describe, expect, it } from "vitest";
import { isSkillText, parseSkill, skillPayload, skillToModule } from "./skill-adapter";

const SKILL = `---
name: pdf-review
description: Reviews PDF reports and lists findings.
license: Apache-2.0
---

# PDF Review

Read the attached report and list every finding with a severity.
`;

describe("skill adapter", () => {
  it("erkennt eine Skill-Datei", () => {
    expect(isSkillText(SKILL, "SKILL.md")).toBe(true);
    expect(isSkillText("nur Text", "notes.md")).toBe(false);
    expect(
      isSkillText("apiVersion: x\nkind: ScopeModule\n", "a.scopem.yaml"),
    ).toBe(false);
  });

  it("liest Kopf und Anweisung", () => {
    const skill = parseSkill(SKILL, "SKILL.md");
    expect(skill.name).toBe("pdf-review");
    expect(skill.title).toBe("Pdf Review");
    expect(skill.description).toContain("Reviews PDF");
    expect(skill.instruction).toContain("list every finding");
  });

  it("leitet einen Namen aus dem Dateinamen ab, wenn der Kopf keinen nennt", () => {
    const skill = parseSkill(`---\ndescription: x\n---\nTu etwas.`, "Daten Pruefer.skill.md");
    expect(skill.name).toBe("daten-pruefer");
  });

  it("weist fehlende Anweisung und fehlenden Kopf zurück", () => {
    expect(() => parseSkill("kein Kopf", "SKILL.md")).toThrow();
    expect(() => parseSkill(`---\nname: a\n---\n`, "SKILL.md")).toThrow();
  });

  it("erzeugt einen begrenzten Agenten-Baustein ohne Außenwirkung", () => {
    const module = skillToModule(parseSkill(SKILL, "SKILL.md"));
    expect(module.metadata.nodeType).toBe("zone");
    expect(module.spec.container?.acceptsChildren).toBe(true);
    expect(module.spec.action.hasSideEffects).toBe(false);
    expect(module.spec.engine.governance?.maxTokenBudget).toBe(8000);
  });

  it("platziert den Skill als Feld mit Auftrag", () => {
    const payload = skillPayload(SKILL, "SKILL.md");
    const node = payload.nodes[0]!;
    expect(node.type).toBe("zone");
    expect(String(node.metadata["agentTask"])).toContain("list every finding");
    expect(node.metadata["moduleRef"]).toBe("pdf-review@1.0.0");
  });
});
