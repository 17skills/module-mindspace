import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertActiveUser, assertBoardRole } from "@/lib/guard.server";

/** Dateiformat der Scope-Sicherung. Bei Änderungen hochzählen. */
export const BACKUP_VERSION = 1;

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

const NODE_COLUMNS = [
  "id",
  "parent_id",
  "type",
  "title",
  "position_x",
  "position_y",
  "width",
  "height",
  "color",
  "source_url",
  "storage_path",
  "mime_type",
  "content",
  "status",
  "metadata",
] as const;

/**
 * Vollständige Sicherung eines Scopes: Module, Verbindungen, Felder/Gruppen und
 * die Angaben der genutzten MCP-Server – bewusst ohne Zugangsschlüssel.
 */
export const exportBoard = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ boardId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await assertBoardRole(context.userId, data.boardId, "viewer");
    const db = await admin();
    const [boardRes, nodeRes, edgeRes, appRes] = await Promise.all([
      db.from("boards").select("title,description").eq("id", data.boardId).maybeSingle(),
      db.from("nodes").select(NODE_COLUMNS.join(",")).eq("board_id", data.boardId),
      db.from("edges").select("id,source_id,target_id,label").eq("board_id", data.boardId),
      db.from("apps").select("title,kind,node_ids,description,access_mode,branding,channels").eq("board_id", data.boardId),
    ]);
    if (!boardRes.data) throw new Error("Scope nicht gefunden");
    const nodes = (nodeRes.data ?? []) as unknown as Record<string, unknown>[];

    // MCP-Server, auf die Werkzeugkarten zeigen – Adresse und Anmeldeart, nie das Token.
    const serverIds = new Set<string>();
    for (const node of nodes) {
      const meta = (node["metadata"] ?? {}) as Record<string, unknown>;
      const id = meta["mcpServerId"];
      if (typeof id === "string" && id) serverIds.add(id);
    }
    let mcpServers: Record<string, unknown>[] = [];
    if (serverIds.size) {
      const { data: servers } = await db
        .from("mcp_servers")
        .select("id,name,url,auth_kind,header_name,tools")
        .in("id", [...serverIds])
        .eq("user_id", context.userId);
      mcpServers = (servers ?? []) as unknown as Record<string, unknown>[];
    }

    return {
      title: String(boardRes.data.title ?? "scope"),
      json: JSON.stringify({
        version: BACKUP_VERSION,
        exportedAt: new Date().toISOString(),
        board: {
          title: boardRes.data.title,
          description: boardRes.data.description ?? null,
        },
        nodes,
        edges: (edgeRes.data ?? []) as unknown as Record<string, unknown>[],
        mcpServers,
        apps: (appRes.data ?? []) as unknown as Record<string, unknown>[],
      }),
    };
  });

const BackupSchema = z.object({
  version: z.number(),
  board: z.object({ title: z.string().default("Wiederhergestellter Scope"), description: z.string().nullable().default(null) }),
  nodes: z.array(z.record(z.string(), z.unknown())).max(2000),
  edges: z.array(z.record(z.string(), z.unknown())).max(4000),
  mcpServers: z.array(z.record(z.string(), z.unknown())).max(50).default([]),
  apps: z.array(z.record(z.string(), z.unknown())).max(50).default([]),
});

function remapMetadata(
  value: unknown,
  map: Map<string, string>,
  servers: Map<string, string>,
): unknown {
  if (typeof value === "string") return map.get(value) ?? servers.get(value) ?? value;
  if (Array.isArray(value)) return value.map((item) => remapMetadata(item, map, servers));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      out[key] = remapMetadata(item, map, servers);
    }
    return out;
  }
  return value;
}

/**
 * Stellt eine Sicherung als neuen Scope wieder her. Alle Kennungen werden neu
 * vergeben, Verweise zwischen Modulen, Feldern und Verbindungen bleiben erhalten.
 */
export const importBoard = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z.object({ backupJson: z.string().max(20_000_000), title: z.string().max(200).optional() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertActiveUser(context.userId);
    let backup: z.infer<typeof BackupSchema>;
    try {
      backup = BackupSchema.parse(JSON.parse(data.backupJson));
    } catch {
      throw new Error("Diese Datei ist keine gültige scopebuilder-Sicherung");
    }
    if (backup.version > BACKUP_VERSION) {
      throw new Error("Diese Sicherung stammt aus einer neueren Version");
    }
    const db = await admin();
    const { activeOrgOf } = await import("@/lib/org-guard.server");
    const orgId = await activeOrgOf(context.userId).catch(() => null);

    const { data: board, error: boardError } = await db
      .from("boards")
      .insert({
        user_id: context.userId,
        org_id: (orgId as { id?: string } | null)?.id ?? null,
        title: data.title?.trim() || backup.board.title,
        description: backup.board.description,
      })
      .select("id")
      .single();
    if (boardError) throw new Error(boardError.message);

    // MCP-Server der Sicherung auf eigene Server mit gleicher Adresse abbilden.
    const serverMap = new Map<string, string>();
    if (backup.mcpServers.length) {
      const { data: mine } = await db
        .from("mcp_servers")
        .select("id,url")
        .eq("user_id", context.userId);
      const byUrl = new Map((mine ?? []).map((row) => [String(row.url), String(row.id)]));
      for (const server of backup.mcpServers) {
        const target = byUrl.get(String(server["url"] ?? ""));
        if (target) serverMap.set(String(server["id"]), target);
      }
    }

    const idMap = new Map<string, string>();
    for (const node of backup.nodes) {
      idMap.set(String(node["id"]), crypto.randomUUID());
    }

    const rows = backup.nodes.map((node) => {
      const oldParent = node["parent_id"];
      return {
        id: idMap.get(String(node["id"]))!,
        board_id: board.id,
        user_id: context.userId,
        parent_id:
          typeof oldParent === "string" ? (idMap.get(oldParent) ?? null) : null,
        type: String(node["type"] ?? "note"),
        title: (node["title"] as string | null) ?? "",
        position_x: Number(node["position_x"] ?? 0),
        position_y: Number(node["position_y"] ?? 0),
        // Größe fehlt (z. B. im Bauplan)? Dann Standardgröße der Datenbank.
        ...(node["width"] == null ? {} : { width: Number(node["width"]) }),
        ...(node["height"] == null ? {} : { height: Number(node["height"]) }),
        color: (node["color"] as string | null) ?? null,
        source_url: (node["source_url"] as string | null) ?? null,
        storage_path: (node["storage_path"] as string | null) ?? null,
        mime_type: (node["mime_type"] as string | null) ?? null,
        content: (node["content"] as string | null) ?? null,
        status: (node["status"] as string | null) ?? "ready",
        metadata: remapMetadata(node["metadata"] ?? {}, idMap, serverMap),
      };
    });

    // Scheitert der Aufbau, bleibt kein leerer Scope zurück.
    const fail = async (message: string): Promise<never> => {
      await db.from("boards").delete().eq("id", board.id);
      throw new Error(`Einspielen fehlgeschlagen: ${message}`);
    };

    for (let index = 0; index < rows.length; index += 200) {
      const { error } = await db.from("nodes").insert(rows.slice(index, index + 200) as never);
      if (error) await fail(error.message);
    }

    const edgeRows = backup.edges
      .map((edge) => {
        const source = idMap.get(String(edge["source_id"]));
        const target = idMap.get(String(edge["target_id"]));
        if (!source || !target) return null;
        return {
          board_id: board.id,
          user_id: context.userId,
          source_id: source,
          target_id: target,
          label: (edge["label"] as string | null) ?? null,
        };
      })
      .filter((row): row is NonNullable<typeof row> => row !== null);
    if (edgeRows.length) {
      const { error } = await db.from("edges").insert(edgeRows as never);
      if (error) throw new Error(error.message);
    }

    // Apps: dieselbe Modulauswahl, Kanäle und Gestaltung, neue Kennungen.
    let appCount = 0;
    for (const app of backup.apps) {
      const nodeIds = (Array.isArray(app["node_ids"]) ? app["node_ids"] : [])
        .map((id) => idMap.get(String(id)))
        .filter((id): id is string => Boolean(id));
      const access = String(app["access_mode"] ?? "restricted");
      const { error } = await db.from("apps").insert({
        board_id: board.id,
        user_id: context.userId,
        org_id: (orgId as { id?: string } | null)?.id ?? null,
        title: String(app["title"] ?? "App").slice(0, 200),
        kind: app["kind"] === "capture" ? "capture" : "cockpit",
        node_ids: nodeIds,
        description: String(app["description"] ?? ""),
        access_mode: access === "public" || access === "org" ? access : "restricted",
        branding: (app["branding"] ?? {}) as never,
        channels: (app["channels"] ?? { web: true, teams: false, mcp: false }) as never,
      } as never);
      if (!error) appCount += 1;
    }

    const missingServers = backup.mcpServers.filter(
      (server) => !serverMap.has(String(server["id"])),
    ).length;

    return {
      boardId: board.id as string,
      nodes: rows.length,
      edges: edgeRows.length,
      apps: appCount,
      missingServers,
    };
  });
