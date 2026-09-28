import { describe, expect, it } from "vitest";
import {
  backupToManifest,
  isManifestText,
  manifestToBackup,
  manifestToMarkdown,
  manifestToYaml,
  parseManifest,
  type BackupShape,
} from "./manifest";

const long = "Erstelle aus dem Foto ein Datenblatt. ".repeat(12);

const backup: BackupShape = {
  version: 1,
  board: { title: "Foto zu Bericht", description: null },
  nodes: [
    { id: "a1", type: "inspect", title: "Kamera", position_x: 0, position_y: 0, metadata: {} },
    { id: "b2", type: "zone", title: "Analyse", position_x: 400, position_y: 0, content: long, metadata: { model: "google/gemini-2.5-flash", link: "a1" } },
    { id: "c3", type: "metric", title: "Ergebnis", position_x: 800, position_y: 0, metadata: {} },
  ],
  edges: [
    { source_id: "a1", target_id: "b2", label: null },
    { source_id: "b2", target_id: "c3", label: null },
  ],
  mcpServers: [],
  apps: [
    { title: "Erfassung", kind: "capture", node_ids: ["a1"], channels: { web: true, teams: false, mcp: false } },
    { title: "Prüfplatz", kind: "cockpit", node_ids: ["b2", "c3"], channels: { web: true, teams: false, mcp: true } },
  ],
};

describe("Scope-Manifest", () => {
  it("vergibt Rollen, Motoren und lesbare Kennungen", () => {
    const m = backupToManifest(backup);
    expect(m.modules.map((x) => x.id)).toEqual(["kamera", "analyse", "ergebnis"]);
    expect(m.modules.map((x) => x.role)).toEqual(["source", "step", "output"]);
    expect(m.modules[1]?.engine).toEqual({ kind: "agent", ref: "google/gemini-2.5-flash", params: {} });
    expect(m.modules[1]?.settings["link"]).toBe("kamera");
    expect(m.apps[0]?.channels).toEqual(["mobile"]);
    expect(m.apps[1]?.channels).toEqual(["web", "mcp"]);
  });

  it("übersteht den Rundlauf über Markdown und YAML", () => {
    const m = backupToManifest(backup);
    const md = manifestToMarkdown(m);
    expect(md).toContain("## #analyse");
    expect(isManifestText(md)).toBe(true);
    const back = parseManifest(md);
    expect(back.warnings).toEqual([]);
    expect(back.manifest.modules[1]?.content).toBe(long.trim());
    expect(back.manifest.links).toHaveLength(2);
    const yaml = parseManifest(manifestToYaml(m));
    expect(yaml.manifest.apps[1]?.modules).toEqual(["analyse", "ergebnis"]);
  });

  it("warnt bei Lücken, statt abzubrechen", () => {
    const text = `scopebuilder: scopebuilder/v1
scope: { title: Handgeschrieben }
modules:
  - { id: foto, type: inspect }
  - { id: bericht, type: output, content: "#fehlt" }
links:
  - { from: foto, to: bericht }
  - { from: foto, to: nirgends }
apps:
  - { title: Mobil, channels: [mobile], modules: [foto, geist] }
`;
    const { manifest, warnings } = parseManifest(text);
    expect(manifest.links).toHaveLength(1);
    expect(warnings).toHaveLength(3);
    const b = manifestToBackup(manifest);
    expect(b.apps?.[0]?.["kind"]).toBe("capture");
    expect(b.nodes).toHaveLength(2);
  });

  it("lehnt fremde Dateien klar ab", () => {
    expect(() => parseManifest("title: nichts")).toThrow(/Scope-Manifest/);
  });
});

import { manifestNotices } from "./manifest";
import { catalogModulePayload, catalogVersions } from "./catalog/instantiate";

describe("Vorlage verlustfrei", () => {
  const rich: BackupShape = {
    ...backup,
    board: { title: "Reich", description: null, rules: { name: "dsgvo", rules: [{ id: "r1" }] }, provenance: { version: "2.1.0" } },
    nodes: [
      ...backup.nodes,
      { id: "d4", type: "mcp", title: "Werkzeug", position_x: 0, position_y: 300, metadata: { mcpServerId: "srv-uuid", mcpServerName: "docs", mcpTool: "search", moduleRef: "mcp-tool-call@1.0.0" } },
    ],
    mcpServers: [{ id: "srv-uuid", name: "docs", url: "https://mcp.example.com", auth_kind: "bearer", header_name: null }],
  };

  it("behält Motor, MCP, Regeln, Herkunft und Baustein im Rundlauf", () => {
    const m = backupToManifest(rich, { author: "a@b.de", origin: "scope:x" });
    const back = parseManifest(manifestToMarkdown(m)).manifest;
    expect(back.rules).toEqual(rich.board.rules);
    expect(back.provenance?.version).toBe("2.1.0");
    expect(back.provenance?.author).toBe("a@b.de");
    expect(back.mcpServers[0]?.url).toBe("https://mcp.example.com");
    const tool = back.modules.find((x) => x.id === "werkzeug")!;
    expect(tool.module).toEqual({ name: "mcp-tool-call", version: "1.0.0" });
    expect(manifestNotices(back, new Map([["mcp-tool-call", "1.0.0"]])).some((n) => n.includes("Prüfsumme"))).toBe(false);
    const b = manifestToBackup(back);
    expect(b.board.rules).toEqual(rich.board.rules);
    const node = b.nodes.find((n) => n["id"] === "werkzeug")!;
    const meta = node["metadata"] as Record<string, unknown>;
    expect(meta["mcpServerId"]).toBe(b.mcpServers[0]?.["id"]);
    expect(meta["mcpTool"]).toBe("search");
  });

  it("Motor-Tausch in der Datei tauscht nur den Motor", () => {
    const m = backupToManifest(rich);
    m.modules[1]!.engine = { kind: "agent", ref: "openai/gpt-6-astra", params: {} };
    const b = manifestToBackup(m);
    expect((b.nodes[1]!["metadata"] as Record<string, unknown>)["model"]).toBe("openai/gpt-6-astra");
    expect(b.edges).toHaveLength(2);
    expect(manifestNotices(m, new Map()).some((n) => n.includes("Prüfsumme"))).toBe(true);
  });

  it("platziert Katalog-Bausteine mit Version und Schutz", () => {
    const payload = catalogModulePayload("webhook-dispatch");
    const meta = payload.nodes[0]!.metadata;
    expect(String(meta["moduleRef"])).toMatch(/^webhook-dispatch@/);
    expect(meta["requiresApproval"]).toBe(true);
    expect(catalogVersions().get("llm-inference")).toBeTruthy();
    const llm = catalogModulePayload("llm-inference").nodes[0]!.metadata;
    expect(llm["governance"]).toBeTruthy();
  });
});
