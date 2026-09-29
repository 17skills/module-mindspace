import { describe, expect, it } from "vitest";
import {
  inferRole,
  isTileRole,
  isVisibleInApp,
  moduleClass,
  readModuleRole,
  roleEditable,
} from "@/lib/module-role";

const node = (type: string, metadata: Record<string, unknown> | null = null) => ({ type, metadata });

describe("module roles", () => {
  it("sorts specialised modules into the domain class", () => {
    expect(moduleClass("risk")).toBe("domain");
    expect(moduleClass("inspect")).toBe("domain");
    expect(moduleClass("chart")).toBe("analytics");
    expect(moduleClass("output")).toBe("io");
    expect(moduleClass("text")).toBe("context");
  });

  it("derives a briefing from a free note and a prompt when it feeds an agent", () => {
    expect(inferRole("text")).toBe("briefing");
    expect(inferRole("text", true)).toBe("prompt");
    expect(inferRole("link")).toBe("reference");
    expect(inferRole("risk")).toBe("module");
  });

  it("prefers the stored role over the derived one", () => {
    expect(readModuleRole(node("text", { moduleRole: "rule" }))).toBe("rule");
    expect(readModuleRole(node("text", { moduleRole: "nonsense" }))).toBe("briefing");
    expect(readModuleRole(node("risk", { moduleRole: "draft" }))).toBe("module");
  });

  it("only lets text and source nodes change their role", () => {
    expect(roleEditable("text")).toBe(true);
    expect(roleEditable("link")).toBe(true);
    expect(roleEditable("risk")).toBe(false);
  });

  it("keeps prompts and drafts out of the delivered app", () => {
    expect(isVisibleInApp("prompt")).toBe(false);
    expect(isVisibleInApp("draft")).toBe(false);
    expect(isVisibleInApp("reference")).toBe(true);
    expect(isTileRole("briefing")).toBe(false);
    expect(isTileRole("module")).toBe(true);
  });
});
