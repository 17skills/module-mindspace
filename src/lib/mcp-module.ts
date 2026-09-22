import type { NodeRecord } from "@/components/canvas/board-context";
import { pickPath } from "@/lib/api-module";

/** Einstellungen eines MCP-Moduls auf dem Canvas. */
export type McpConfig = {
  serverId: string;
  serverName: string;
  tool: string;
  /** Eingabewerte als JSON-Objekt-Text. */
  args: string;
  /** Pfad in die Antwort, z. B. "items.0.value". */
  pick: string;
  lastAt: string | null;
  lastError: string | null;
};

function text(raw: unknown): string {
  return typeof raw === "string" ? raw : "";
}

export function readMcp(record: NodeRecord | undefined | null): McpConfig {
  const meta = (record?.metadata ?? {}) as Record<string, unknown>;
  return {
    serverId: text(meta["mcpServerId"]),
    serverName: text(meta["mcpServerName"]),
    tool: text(meta["mcpTool"]),
    args: text(meta["mcpArgs"]) || "{}",
    pick: text(meta["pick"]),
    lastAt: typeof meta["lastAt"] === "string" ? meta["lastAt"] : null,
    lastError: typeof meta["lastError"] === "string" ? meta["lastError"] : null,
  };
}

/** Zahl, die ein MCP-Modul über seine Verbindungen weitergibt. */
export function mcpValue(record: NodeRecord | undefined | null): number | null {
  const config = readMcp(record);
  if (!config.pick.trim()) return null;
  const picked = pickPath(record?.content, config.pick);
  if (typeof picked === "number" && Number.isFinite(picked)) return picked;
  if (typeof picked === "string" && picked.trim()) {
    const parsed = Number(picked.replace(/[^\d.,-]/g, "").replace(/\.(?=\d{3}\b)/g, "").replace(",", "."));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/** Lesbare Kurzfassung der letzten Antwort. */
export function mcpPreview(record: NodeRecord | undefined | null): string {
  const content = record?.content ?? "";
  if (!content) return "";
  try {
    return JSON.stringify(JSON.parse(content), null, 2).slice(0, 4000);
  } catch {
    return content.slice(0, 4000);
  }
}
