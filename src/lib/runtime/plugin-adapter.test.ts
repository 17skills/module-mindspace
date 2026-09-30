import { describe, expect, it } from "vitest";
import { zipSync, strToU8 } from "fflate";
import { defaultSelection, parsePluginArchive, pluginPayload } from "./plugin-adapter";

const zip = zipSync({
  "demo/.claude-plugin/plugin.json": strToU8(JSON.stringify({ name: "demo", version: "1.2.0", hooks: {} })),
  "demo/skills/review/SKILL.md": strToU8("---\nname: review\ndescription: Prüft Texte\n---\nPrüfe den Text."),
  "demo/commands/summary.md": strToU8("---\ndescription: Kurzfassung\n---\nFasse $ARGUMENTS zusammen."),
  "demo/.mcp.json": strToU8(
    JSON.stringify({ mcpServers: { web: { url: "https://mcp.example.com" }, local: { command: "node" }, plain: { url: "http://x" } } }),
  ),
  "demo/hooks/hooks.json": strToU8("{}"),
  "demo/scripts/run.sh": strToU8("rm -rf /"),
});

describe("plugin-adapter", () => {
  const preview = parsePluginArchive(zip);
  it("erkennt Bestandteile", () => {
    expect(preview.name).toBe("demo");
    expect(preview.skills.map((s) => s.skill.name)).toEqual(["review"]);
    expect(preview.commands[0]?.name).toBe("/summary");
    expect(preview.mcpServers.find((m) => m.name === "web")?.connectable).toBe(true);
    expect(preview.mcpServers.find((m) => m.name === "local")?.connectable).toBe(false);
    expect(preview.mcpServers.find((m) => m.name === "plain")?.connectable).toBe(false);
    expect(preview.skipped.map((s) => s.path)).toEqual(
      expect.arrayContaining(["hooks/hooks.json", "scripts/run.sh", "plugin.json › hooks"]),
    );
  });
  it("übernimmt nur die Auswahl, nie unsichere Server", () => {
    const all = pluginPayload(preview, { ...defaultSelection(preview), mcpServers: preview.mcpServers.map((m) => m.id) });
    expect(all.nodes).toHaveLength(3);
    const none = pluginPayload(preview, { skills: [], mcpServers: [], commands: [preview.commands[0]!.id] });
    expect(none.nodes).toHaveLength(1);
    expect(none.nodes[0]?.metadata["moduleRole"]).toBe("prompt");
  });
  it("lehnt Nicht-ZIP ab", () => {
    expect(() => parsePluginArchive(strToU8("kein zip"))).toThrow();
  });
});
