import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Json } from "@/integrations/supabase/types";
import { encryptKey } from "@/lib/ai-keys.server";
import { callTool, connectAndList, safeMcpUrl, targetFromRow } from "@/lib/mcp-client.server";

/** Werkzeugbeschreibung, wie sie zum Browser übertragen wird. */
export type McpToolInfo = {
  name: string;
  title: string;
  description: string;
  inputSchema: Json;
};

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

/** Datensparsames Protokoll – gleiche Routine wie im übrigen Konto-Bereich. */
async function audit(entry: { actorId: string; action: string; detail?: string }) {
  const db = await admin();
  await db.from("audit_log").insert({
    actor_id: entry.actorId,
    subject_user_id: entry.actorId,
    action: entry.action,
    detail: entry.detail ?? null,
  });
}

export type McpServerInfoRow = {
  id: string;
  name: string;
  url: string;
  authKind: "none" | "bearer" | "header";
  headerName: string | null;
  hasToken: boolean;
  tools: McpToolInfo[];
  serverName: string;
  lastCheckAt: string | null;
  lastError: string | null;
};

type Row = {
  id: string;
  name: string;
  url: string;
  auth_kind: string;
  header_name: string | null;
  encrypted_token: string | null;
  tools: unknown;
  server_info: unknown;
  last_check_at: string | null;
  last_error: string | null;
};

function toolsOf(raw: unknown): McpToolInfo[] {
  if (!Array.isArray(raw)) return [];
  const tools: McpToolInfo[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const entry = item as Record<string, unknown>;
    if (typeof entry["name"] !== "string") continue;
    tools.push({
      name: entry["name"],
      title: typeof entry["title"] === "string" ? entry["title"] : "",
      description: typeof entry["description"] === "string" ? entry["description"] : "",
      inputSchema: (entry["inputSchema"] ?? {}) as Json,
    });
  }
  return tools;
}

function toRow(row: Row): McpServerInfoRow {
  const info = (row.server_info ?? {}) as Record<string, unknown>;
  return {
    id: row.id,
    name: row.name,
    url: row.url,
    authKind: row.auth_kind === "bearer" || row.auth_kind === "header" ? row.auth_kind : "none",
    headerName: row.header_name,
    hasToken: Boolean(row.encrypted_token),
    tools: toolsOf(row.tools),
    serverName: typeof info["name"] === "string" ? info["name"] : "",
    lastCheckAt: row.last_check_at,
    lastError: row.last_error,
  };
}

const SELECT =
  "id,name,url,auth_kind,header_name,encrypted_token,tools,server_info,last_check_at,last_error";

/** Alle eigenen MCP-Server samt Werkzeugverzeichnis – ohne Zugangsschlüssel. */
export const listMcpServers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<McpServerInfoRow[]> => {
    const { data, error } = await context.supabase
      .from("mcp_servers")
      .select(SELECT)
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    return ((data as Row[] | null) ?? []).map(toRow);
  });

const SaveInput = z.object({
  id: z.string().uuid().optional(),
  name: z.string().min(1).max(80),
  url: z.string().min(8).max(500),
  authKind: z.enum(["none", "bearer", "header"]).default("none"),
  headerName: z.string().max(80).optional(),
  /** Leer lassen, um einen bereits hinterlegten Schlüssel zu behalten. */
  token: z.string().max(4000).optional(),
});

/** Legt einen MCP-Server an oder ändert ihn – inklusive Handschlag und Werkzeugabruf. */
export const saveMcpServer = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => SaveInput.parse(input))
  .handler(async ({ data, context }): Promise<McpServerInfoRow> => {
    const url = safeMcpUrl(data.url).toString();
    if (data.authKind === "header" && !data.headerName?.trim()) {
      throw new Error("Für eigene Kopfzeilen brauchst du einen Feldnamen");
    }

    let token: string | null = null;
    if (data.authKind !== "none") {
      if (data.token?.trim()) {
        token = data.token.trim();
      } else if (data.id) {
        const { data: existing } = await context.supabase
          .from("mcp_servers")
          .select("encrypted_token")
          .eq("id", data.id)
          .maybeSingle();
        const packed = (existing as { encrypted_token: string | null } | null)?.encrypted_token ?? null;
        if (!packed) throw new Error("Bitte den Zugangsschlüssel eintragen");
        const { decryptKey } = await import("@/lib/ai-keys.server");
        token = decryptKey(packed);
      } else {
        throw new Error("Bitte den Zugangsschlüssel eintragen");
      }
    }

    const target = {
      url,
      authKind: data.authKind,
      headerName: data.headerName?.trim() || null,
      token,
    };
    const { info, tools } = await connectAndList(target);

    const encrypted_token = token ? encryptKey(token) : null;
    const payload = {
      user_id: context.userId,
      name: data.name.trim(),
      url,
      auth_kind: data.authKind,
      header_name: target.headerName,
      encrypted_token,
      tools: tools as unknown as Json,
      server_info: info as unknown as Json,
      last_check_at: new Date().toISOString(),
      last_error: null,
      updated_at: new Date().toISOString(),
    };

    const query = data.id
      ? context.supabase.from("mcp_servers").update(payload).eq("id", data.id).select(SELECT)
      : context.supabase.from("mcp_servers").insert(payload).select(SELECT);
    const { data: saved, error } = await query.maybeSingle();
    if (error) throw new Error(error.message);
    if (!saved) throw new Error("Der MCP-Server konnte nicht gespeichert werden");

    await audit({
      actorId: context.userId,
      action: data.id ? "mcp_server.updated" : "mcp_server.added",
      detail: new URL(url).host,
    });
    return toRow(saved as Row);
  });

/** Prüft die Verbindung erneut und aktualisiert das Werkzeugverzeichnis. */
export const refreshMcpServer = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<McpServerInfoRow> => {
    const { data: row, error } = await context.supabase
      .from("mcp_servers")
      .select(SELECT)
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) throw new Error("MCP-Server nicht gefunden");

    try {
      const { info, tools } = await connectAndList(targetFromRow(row as Row));
      const { data: saved } = await context.supabase
        .from("mcp_servers")
        .update({
          tools: tools as unknown as Json,
          server_info: info as unknown as Json,
          last_check_at: new Date().toISOString(),
          last_error: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", data.id)
        .select(SELECT)
        .maybeSingle();
      return toRow((saved ?? row) as Row);
    } catch (problem) {
      const message = problem instanceof Error ? problem.message : "Verbindung fehlgeschlagen";
      await context.supabase
        .from("mcp_servers")
        .update({ last_error: message, last_check_at: new Date().toISOString() })
        .eq("id", data.id);
      throw new Error(message);
    }
  });

/** Entfernt einen MCP-Server samt Zugangsschlüssel. */
export const deleteMcpServer = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z.object({ id: z.string().uuid(), confirm: z.literal(true) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: row } = await context.supabase
      .from("mcp_servers")
      .select("name")
      .eq("id", data.id)
      .maybeSingle();
    const { error } = await context.supabase.from("mcp_servers").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    await audit({
      actorId: context.userId,
      action: "mcp_server.deleted",
      detail: (row as { name: string } | null)?.name ?? null ?? undefined,
    });
    return { ok: true as const };
  });

/** Führt ein Werkzeug eines eigenen MCP-Servers aus (Aufruf eines Canvas-Moduls). */
export const runMcpTool = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({
        serverId: z.string().uuid(),
        tool: z.string().min(1).max(200),
        args: z.string().max(20_000).default("{}"),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    let args: Record<string, unknown> = {};
    const raw = data.args.trim();
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as unknown;
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          throw new Error("shape");
        }
        args = parsed as Record<string, unknown>;
      } catch {
        throw new Error("Die Eingabewerte müssen ein JSON-Objekt sein, z. B. { \"query\": \"Text\" }");
      }
    }

    const { data: row, error } = await context.supabase
      .from("mcp_servers")
      .select(SELECT)
      .eq("id", data.serverId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) throw new Error("MCP-Server nicht gefunden");

    const known = toolsOf((row as Row).tools);
    if (known.length && !known.some((tool) => tool.name === data.tool)) {
      throw new Error(`Das Werkzeug „${data.tool}“ gehört nicht zu diesem MCP-Server`);
    }

    const result = await callTool(targetFromRow(row as Row), data.tool, args);
    return { ...result, at: new Date().toISOString() };
  });
