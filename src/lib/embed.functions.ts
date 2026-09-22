import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

type Json = string | number | boolean | null | Json[] | { [key: string]: Json };
type Row = Record<string, unknown>;
type JsonRow = Record<string, Json>;

function metaZoneId(row: Row): string | null {
  const meta = (row["metadata"] ?? {}) as Record<string, unknown>;
  const id = meta["zoneId"];
  return typeof id === "string" && id ? id : null;
}

function inside(row: Row, zone: Row): boolean {
  const zx = Number(zone["position_x"] ?? 0);
  const zy = Number(zone["position_y"] ?? 0);
  const zw = Number(zone["width"] ?? 420);
  const zh = Number(zone["height"] ?? 360);
  const x = Number(row["position_x"] ?? 0);
  const y = Number(row["position_y"] ?? 0);
  return x >= zx && y >= zy && x <= zx + zw && y <= zy + zh;
}

/** One background field with its modules — for embedding (Teams tab, iframe). */
export const getEmbedZone = createServerFn({ method: "POST" })
  .validator((input: unknown) => z.object({ zoneId: z.string().uuid() }).parse(input))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: zone, error } = await supabaseAdmin
      .from("nodes")
      .select("*")
      .eq("id", data.zoneId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!zone || zone.type !== "zone") throw new Error("Dieses Feld gibt es nicht");

    const { data: board, error: boardError } = await supabaseAdmin
      .from("boards")
      .select("id,title,is_public")
      .eq("id", zone.board_id)
      .maybeSingle();
    if (boardError) throw new Error(boardError.message);
    if (!board || !board.is_public) {
      throw new Error("Dieses Feld ist noch nicht freigegeben. Bitte das Board freigeben.");
    }

    const [nodeRes, edgeRes] = await Promise.all([
      supabaseAdmin.from("nodes").select("*").eq("board_id", board.id),
      supabaseAdmin.from("edges").select("*").eq("board_id", board.id),
    ]);
    if (nodeRes.error) throw new Error(nodeRes.error.message);
    if (edgeRes.error) throw new Error(edgeRes.error.message);

    const all = (nodeRes.data ?? []) as Row[];
    const members = all.filter((row) => {
      if (row["id"] === zone.id) return false;
      if (row["type"] === "zone" || row["type"] === "chat") return false;
      const assigned = metaZoneId(row);
      if (assigned) return assigned === zone.id;
      return inside(row, zone as Row);
    });
    const ids = new Set(members.map((row) => String(row["id"])));
    const edges = (edgeRes.data ?? []).filter(
      (edge) => ids.has(String(edge.source_id)) && ids.has(String(edge.target_id)),
    );

    return {
      board: { id: board.id, title: board.title as string },
      zone: {
        id: zone.id as string,
        title: (zone.title as string | null) ?? "Feld",
        content: (zone.content as string | null) ?? "",
      },
      nodes: members,
      edges,
    };
  });
