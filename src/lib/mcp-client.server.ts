// ============= Server-only: Client für externe MCP-Server (Streamable HTTP) =============
import { decryptKey } from "@/lib/ai-keys.server";

export const MCP_PROTOCOL_VERSION = "2025-06-18";
const TIMEOUT_MS = 25_000;
const MAX_BODY = 200_000;

export type McpAuthKind = "none" | "bearer" | "header";

export type McpTarget = {
  url: string;
  authKind: McpAuthKind;
  headerName: string | null;
  /** Bereits entschlüsselter Zugangsschlüssel. */
  token: string | null;
};

export type McpTool = {
  name: string;
  title: string;
  description: string;
  /** JSON-Schema der Eingabe, so wie der Server es meldet. */
  inputSchema: Record<string, unknown>;
};

export type McpServerInfo = { name: string; version: string; protocolVersion: string };

const PRIVATE_HOST =
  /^(localhost|127\.|0\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|\[?::1\]?|.*\.internal|metadata\.google\.internal)/i;

/** Nur öffentliche https-Adressen zulassen (Schutz vor Zugriffen ins interne Netz). */
export function safeMcpUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new Error("Die Adresse des MCP-Servers ist ungültig");
  }
  if (url.protocol !== "https:") throw new Error("Nur https-Adressen sind erlaubt");
  if (PRIVATE_HOST.test(url.hostname)) throw new Error("Diese Adresse ist nicht erlaubt");
  return url;
}

export function targetFromRow(row: {
  url: string;
  auth_kind: string;
  header_name: string | null;
  encrypted_token: string | null;
}): McpTarget {
  const authKind: McpAuthKind =
    row.auth_kind === "bearer" || row.auth_kind === "header" ? row.auth_kind : "none";
  return {
    url: row.url,
    authKind,
    headerName: row.header_name,
    token: row.encrypted_token && authKind !== "none" ? decryptKey(row.encrypted_token) : null,
  };
}

function authHeaders(target: McpTarget): Record<string, string> {
  if (target.authKind === "bearer" && target.token) {
    return { authorization: `Bearer ${target.token}` };
  }
  if (target.authKind === "header" && target.token && target.headerName?.trim()) {
    return { [target.headerName.trim().toLowerCase()]: target.token };
  }
  return {};
}

type RpcResult = { result?: unknown; error?: { code?: number; message?: string } };

/** Liest eine Antwort – egal ob reines JSON oder Ereignisstrom (SSE). */
function parseBody(text: string, contentType: string, id: number): RpcResult | null {
  if (contentType.includes("text/event-stream")) {
    let found: RpcResult | null = null;
    for (const line of text.split(/\r?\n/)) {
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      try {
        const parsed = JSON.parse(payload) as RpcResult & { id?: number };
        if (parsed.id === id || parsed.result !== undefined || parsed.error) found = parsed;
      } catch {
        /* Teilstücke ignorieren */
      }
    }
    return found;
  }
  if (!text.trim()) return null;
  return JSON.parse(text) as RpcResult;
}

type Session = { id: string | null };

async function rpc(
  target: McpTarget,
  session: Session,
  id: number,
  method: string,
  params: Record<string, unknown>,
): Promise<unknown> {
  const url = safeMcpUrl(target.url);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "mcp-protocol-version": MCP_PROTOCOL_VERSION,
        ...(session.id ? { "mcp-session-id": session.id } : {}),
        ...authHeaders(target),
      },
      body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
    });

    const sessionId = response.headers.get("mcp-session-id");
    if (sessionId) session.id = sessionId;

    const text = (await response.text()).slice(0, MAX_BODY);
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        throw new Error(
          `Der MCP-Server hat den Zugang abgelehnt [${response.status}]. Prüfe den Zugangsschlüssel.`,
        );
      }
      throw new Error(`MCP-Server antwortet mit Fehler [${response.status}]: ${text.slice(0, 300)}`);
    }

    const parsed = parseBody(text, response.headers.get("content-type") ?? "", id);
    if (!parsed) throw new Error("Der MCP-Server hat keine verwertbare Antwort geliefert");
    if (parsed.error) throw new Error(parsed.error.message || "Der MCP-Server meldet einen Fehler");
    return parsed.result;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Verbindung fehlgeschlagen";
    throw new Error(message.toLowerCase().includes("abort") ? "Zeitüberschreitung beim MCP-Server" : message);
  } finally {
    clearTimeout(timer);
  }
}

async function notify(target: McpTarget, session: Session, method: string) {
  const url = safeMcpUrl(target.url);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    await fetch(url, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "mcp-protocol-version": MCP_PROTOCOL_VERSION,
        ...(session.id ? { "mcp-session-id": session.id } : {}),
        ...authHeaders(target),
      },
      body: JSON.stringify({ jsonrpc: "2.0", method, params: {} }),
    });
  } catch {
    /* Hinweise dürfen den Ablauf nicht stoppen */
  } finally {
    clearTimeout(timer);
  }
}

async function handshake(target: McpTarget): Promise<{ session: Session; info: McpServerInfo }> {
  const session: Session = { id: null };
  const result = (await rpc(target, session, 1, "initialize", {
    protocolVersion: MCP_PROTOCOL_VERSION,
    capabilities: {},
    clientInfo: { name: "scopebuilder", version: "1.0" },
  })) as { serverInfo?: { name?: string; version?: string }; protocolVersion?: string };
  await notify(target, session, "notifications/initialized");
  return {
    session,
    info: {
      name: result?.serverInfo?.name ?? "MCP-Server",
      version: result?.serverInfo?.version ?? "",
      protocolVersion: result?.protocolVersion ?? MCP_PROTOCOL_VERSION,
    },
  };
}

function toTool(raw: unknown): McpTool | null {
  const row = (raw ?? {}) as Record<string, unknown>;
  const name = typeof row["name"] === "string" ? row["name"] : "";
  if (!name) return null;
  const schema = row["inputSchema"];
  return {
    name,
    title: typeof row["title"] === "string" ? row["title"] : name,
    description: typeof row["description"] === "string" ? row["description"].slice(0, 600) : "",
    inputSchema:
      schema && typeof schema === "object" ? (schema as Record<string, unknown>) : { type: "object" },
  };
}

/** Verbindet sich, meldet sich an und liest das Werkzeugverzeichnis. */
export async function connectAndList(
  target: McpTarget,
): Promise<{ info: McpServerInfo; tools: McpTool[] }> {
  const { session, info } = await handshake(target);
  const result = (await rpc(target, session, 2, "tools/list", {})) as { tools?: unknown[] };
  const tools = (result?.tools ?? [])
    .map(toTool)
    .filter((tool): tool is McpTool => tool !== null)
    .slice(0, 200);
  return { info, tools };
}

export type McpCallResult = { text: string; structured: unknown; isError: boolean };

/** Ruft ein Werkzeug des MCP-Servers auf und gibt die Antwort als Text/JSON zurück. */
export async function callTool(
  target: McpTarget,
  tool: string,
  args: Record<string, unknown>,
): Promise<McpCallResult> {
  const { session } = await handshake(target);
  const result = (await rpc(target, session, 3, "tools/call", {
    name: tool,
    arguments: args,
  })) as {
    content?: { type?: string; text?: string }[];
    structuredContent?: unknown;
    isError?: boolean;
  };

  const parts = (result?.content ?? [])
    .map((item) => (typeof item?.text === "string" ? item.text : ""))
    .filter(Boolean);
  const structured = result?.structuredContent;
  const text = structured !== undefined
    ? JSON.stringify(structured, null, 2)
    : parts.join("\n\n");

  return {
    text: text.slice(0, MAX_BODY),
    structured: structured ?? null,
    isError: result?.isError === true,
  };
}
