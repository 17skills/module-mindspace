import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertBoardRole } from "@/lib/guard.server";

/** Wie viele Stände je Scope aufbewahrt werden. */
const KEEP = 50;

const NODE_COLUMNS =
  "id,parent_id,type,title,position_x,position_y,width,height,color,source_url,storage_path,mime_type,content,status,metadata";

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

type Db = Awaited<ReturnType<typeof admin>>;

async function snapshotOf(db: Db, boardId: string) {
  const [nodeRes, edgeRes] = await Promise.all([
    db.from("nodes").select(NODE_COLUMNS).eq("board_id", boardId),
    db.from("edges").select("id,source_id,target_id,label").eq("board_id", boardId),
  ]);
  return {
    nodes: (nodeRes.data ?? []) as unknown as Record<string, unknown>[],
    edges: (edgeRes.data ?? []) as unknown as Record<string, unknown>[],
  };
}

async function writeVersion(
  db: Db,
  boardId: string,
  userId: string,
  label: string | null,
  kind: string,
) {
  const snapshot = await snapshotOf(db, boardId);
  const { data, error } = await db
    .from("board_versions")
    .insert({
      board_id: boardId,
      created_by: userId,
      label,
      kind,
      node_count: snapshot.nodes.length,
      edge_count: snapshot.edges.length,
      snapshot: snapshot as never,
    })
    .select("id,created_at")
    .single();
  if (error) throw new Error(error.message);

  // Alte Stände aufräumen
  const { data: old } = await db
    .from("board_versions")
    .select("id")
    .eq("board_id", boardId)
    .order("created_at", { ascending: false })
    .range(KEEP, KEEP + 200);
  if (old?.length) {
    await db.from("board_versions").delete().in("id", old.map((row) => row.id));
  }
  return { id: data.id as string, createdAt: data.created_at as string, ...snapshot };
}

/** Aktuellen Stand eines Scopes als Version sichern. */
export const createBoardVersion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({
        boardId: z.string().uuid(),
        label: z.string().max(120).optional(),
        kind: z.enum(["manuell", "automatisch"]).default("manuell"),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertBoardRole(context.userId, data.boardId, "editor");
    const db = await admin();

    if (data.kind === "automatisch") {
      // Höchstens ein automatischer Stand je Stunde
      const { data: last } = await db
        .from("board_versions")
        .select("created_at")
        .eq("board_id", data.boardId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (last && Date.now() - new Date(last.created_at).getTime() < 60 * 60 * 1000) {
        return { id: null, skipped: true };
      }
    }

    const version = await writeVersion(
      db,
      data.boardId,
      context.userId,
      data.label?.trim() || null,
      data.kind,
    );
    return { id: version.id, skipped: false };
  });

/** Alle gesicherten Stände eines Scopes, neueste zuerst. */
export const listBoardVersions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ boardId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await assertBoardRole(context.userId, data.boardId, "viewer");
    const db = await admin();
    const { data: rows, error } = await db
      .from("board_versions")
      .select("id,label,kind,node_count,edge_count,created_at,created_by")
      .eq("board_id", data.boardId)
      .order("created_at", { ascending: false })
      .limit(KEEP);
    if (error) throw new Error(error.message);

    const ids = [...new Set((rows ?? []).map((row) => row.created_by).filter(Boolean))] as string[];
    const names = new Map<string, string>();
    if (ids.length) {
      const { data: profiles } = await db
        .from("profiles")
        .select("id,full_name,email")
        .in("id", ids);
      for (const profile of profiles ?? []) {
        names.set(profile.id, profile.full_name || profile.email || "Unbekannt");
      }
    }

    return (rows ?? []).map((row) => ({
      id: row.id as string,
      label: (row.label as string | null) ?? null,
      kind: row.kind as string,
      nodes: row.node_count as number,
      edges: row.edge_count as number,
      createdAt: row.created_at as string,
      author: row.created_by ? (names.get(row.created_by) ?? "Unbekannt") : "System",
    }));
  });

/** Kurzüberblick über einen gesicherten Stand, ohne ihn wiederherzustellen. */
export const getBoardVersion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ versionId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const db = await admin();
    const { data: row, error } = await db
      .from("board_versions")
      .select("board_id,label,kind,created_at,snapshot")
      .eq("id", data.versionId)
      .maybeSingle();
    if (error || !row) throw new Error("Dieser Stand ist nicht mehr vorhanden");
    await assertBoardRole(context.userId, row.board_id as string, "viewer");
    const snapshot = row.snapshot as { nodes?: Record<string, unknown>[]; edges?: unknown[] };
    const nodes = snapshot.nodes ?? [];
    return {
      label: (row.label as string | null) ?? null,
      kind: row.kind as string,
      createdAt: row.created_at as string,
      edges: (snapshot.edges ?? []).length,
      modules: nodes.slice(0, 200).map((node) => ({
        id: String(node["id"]),
        type: String(node["type"] ?? "note"),
        title: (node["title"] as string | null) ?? null,
      })),
    };
  });

/**
 * Einen früheren Stand wiederherstellen. Der aktuelle Stand wird vorher
 * automatisch gesichert, damit nichts unwiederbringlich verloren geht.
 */
export const restoreBoardVersion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ versionId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const db = await admin();
    const { data: row, error } = await db
      .from("board_versions")
      .select("board_id,snapshot,created_at")
      .eq("id", data.versionId)
      .maybeSingle();
    if (error || !row) throw new Error("Dieser Stand ist nicht mehr vorhanden");
    const boardId = row.board_id as string;
    await assertBoardRole(context.userId, boardId, "editor");

    await writeVersion(db, boardId, context.userId, "Vor Wiederherstellung", "automatisch");

    const snapshot = row.snapshot as {
      nodes?: Record<string, unknown>[];
      edges?: Record<string, unknown>[];
    };
    const nodes = snapshot.nodes ?? [];
    const edges = snapshot.edges ?? [];

    await db.from("edges").delete().eq("board_id", boardId);
    await db.from("nodes").delete().eq("board_id", boardId);

    const nodeRows = nodes.map((node) => ({
      id: String(node["id"]),
      board_id: boardId,
      user_id: context.userId,
      parent_id: (node["parent_id"] as string | null) ?? null,
      type: String(node["type"] ?? "note"),
      title: (node["title"] as string | null) ?? null,
      position_x: Number(node["position_x"] ?? 0),
      position_y: Number(node["position_y"] ?? 0),
      width: node["width"] == null ? null : Number(node["width"]),
      height: node["height"] == null ? null : Number(node["height"]),
      color: (node["color"] as string | null) ?? null,
      source_url: (node["source_url"] as string | null) ?? null,
      storage_path: (node["storage_path"] as string | null) ?? null,
      mime_type: (node["mime_type"] as string | null) ?? null,
      content: (node["content"] as string | null) ?? null,
      status: (node["status"] as string | null) ?? "ready",
      metadata: node["metadata"] ?? {},
    }));
    for (let index = 0; index < nodeRows.length; index += 200) {
      const { error: insertError } = await db
        .from("nodes")
        .insert(nodeRows.slice(index, index + 200) as never);
      if (insertError) throw new Error(insertError.message);
    }

    const nodeIds = new Set(nodeRows.map((node) => node.id));
    const edgeRows = edges
      .filter(
        (edge) =>
          nodeIds.has(String(edge["source_id"])) && nodeIds.has(String(edge["target_id"])),
      )
      .map((edge) => ({
        id: String(edge["id"] ?? crypto.randomUUID()),
        board_id: boardId,
        user_id: context.userId,
        source_id: String(edge["source_id"]),
        target_id: String(edge["target_id"]),
        label: (edge["label"] as string | null) ?? null,
      }));
    if (edgeRows.length) {
      const { error: edgeError } = await db.from("edges").insert(edgeRows as never);
      if (edgeError) throw new Error(edgeError.message);
    }

    return { nodes: nodeRows.length, edges: edgeRows.length };
  });
