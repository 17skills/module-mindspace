import { describe, expect, it } from "vitest";
import { safeMcpUrl } from "@/lib/mcp-client.server";
import { mcpValue, readMcp } from "@/lib/mcp-module";
import type { NodeRecord } from "@/components/canvas/board-context";

function record(metadata: Record<string, unknown>, content = ""): NodeRecord {
  return { id: "n1", type: "mcp", title: "MCP", content, metadata } as unknown as NodeRecord;
}

describe("safeMcpUrl", () => {
  it("erlaubt öffentliche https-Adressen", () => {
    expect(safeMcpUrl("https://example.com/mcp").host).toBe("example.com");
  });

  it("weist http ab", () => {
    expect(() => safeMcpUrl("http://example.com/mcp")).toThrow();
  });

  it("weist lokale und private Adressen ab", () => {
    expect(() => safeMcpUrl("https://localhost/mcp")).toThrow();
    expect(() => safeMcpUrl("https://192.168.1.10/mcp")).toThrow();
  });
});

describe("MCP-Modul", () => {
  it("liest Einstellungen mit sinnvollen Vorgaben", () => {
    const config = readMcp(record({}));
    expect(config.args).toBe("{}");
    expect(config.tool).toBe("");
  });

  it("gibt den gewählten Zahlenwert an die Verbindung weiter", () => {
    const node = record({ pick: "items.0.value" }, JSON.stringify({ items: [{ value: 42 }] }));
    expect(mcpValue(node)).toBe(42);
  });

  it("bleibt ohne Feldangabe leer", () => {
    expect(mcpValue(record({}, '{"value":7}'))).toBeNull();
  });
});
