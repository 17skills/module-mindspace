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
  /** Formularwerte je Eingabeparameter. */
  inputs: Record<string, string>;
  /** Parameter, die ihren Wert aus einem verbundenen Modul beziehen (Parameter → Modul-ID). */
  bindings: Record<string, string>;
  /** "form" = geführte Felder, "json" = freies JSON. */
  mode: "form" | "json";
  /** Auswahl je verbundener Textkarte: "" = ganz, "off" = aus, sonst Abschnittstitel mit "|" getrennt. */
  context: Record<string, string>;
  lastAt: string | null;
  lastError: string | null;
};

function text(raw: unknown): string {
  return typeof raw === "string" ? raw : "";
}

function textMap(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value === "string") out[key] = value;
  }
  return out;
}

export function readMcp(record: NodeRecord | undefined | null): McpConfig {
  const meta = (record?.metadata ?? {}) as Record<string, unknown>;
  return {
    serverId: text(meta["mcpServerId"]),
    serverName: text(meta["mcpServerName"]),
    tool: text(meta["mcpTool"]),
    args: text(meta["mcpArgs"]) || "{}",
    pick: text(meta["pick"]),
    inputs: textMap(meta["mcpInputs"]),
    bindings: textMap(meta["mcpBindings"]),
    mode: meta["mcpMode"] === "json" ? "json" : "form",
    context: textMap(meta["mcpContext"]),
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

/** Ein Eintrag der Ausführungshistorie einer MCP-Werkzeugkarte. */
export type McpRun = {
  at: string;
  tool: string;
  /** Verwendete Eingaben als JSON-Text. */
  args: string;
  ok: boolean;
  error: string | null;
  /** Kurzfassung der Antwort. */
  preview: string;
};

/** Liest die gespeicherte Ausführungshistorie (neueste zuerst). */
export function readMcpHistory(record: NodeRecord | undefined | null): McpRun[] {
  const raw = (record?.metadata as Record<string, unknown> | null | undefined)?.["mcpHistory"];
  if (!Array.isArray(raw)) return [];
  const out: McpRun[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const entry = item as Record<string, unknown>;
    if (typeof entry["at"] !== "string") continue;
    out.push({
      at: entry["at"],
      tool: text(entry["tool"]),
      args: text(entry["args"]),
      ok: entry["ok"] !== false,
      error: typeof entry["error"] === "string" ? entry["error"] : null,
      preview: text(entry["preview"]),
    });
  }
  return out;
}

/** Hängt einen Lauf vorne an und begrenzt die Historie. */
export function appendMcpRun(history: McpRun[], entry: McpRun, max = 10): McpRun[] {
  return [entry, ...history].slice(0, max);
}

/**
 * Welche Teile einer verbundenen Textkarte als Kontext gelten.
 * "" bzw. fehlend = ganze Karte, "off" = ausgeschlossen,
 * sonst eine Liste von Abschnittstiteln, getrennt durch "|".
 */
export function contextChoice(config: McpConfig, nodeId: string): string {
  return config.context[nodeId] ?? "";
}

export function readMcpContext(record: NodeRecord | undefined | null): Record<string, string> {
  return textMap((record?.metadata as Record<string, unknown> | null | undefined)?.["mcpContext"]);
}
