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
    const { assertRate, callerKey } = await import("@/lib/rate-limit.server");
    const { getRequest } = await import("@tanstack/react-start/server");
    let caller = "anon";
    try {
      const request = getRequest();
      if (request) caller = await callerKey(request);
    } catch {
      /* kein Request-Kontext */
    }
    assertRate(`embed:${caller}`, 60, 60_000);

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
      .select("id,title,is_public,share_revoked_at,share_expires_at,share_password_hash")
      .eq("id", zone.board_id)
      .maybeSingle();
    if (boardError) throw new Error(boardError.message);
    const zoneMeta = (zone.metadata ?? {}) as Record<string, unknown>;
    // Der Gastlink des Scopes gilt nur, solange er gültig und ohne Passwort ist –
    // sonst ließen sich Widerruf, Ablauf und Passwort über die Einbettung umgehen.
    const { shareLinkOpen } = await import("@/lib/guest-view");
    const shared = shareLinkOpen(board, { requirePasswordless: true }) || zoneMeta["embed"] === true;
    if (!board || !shared) {
      throw new Error(
        "Dieses Feld ist noch nicht freigegeben. Bitte am Feld auf „Als App öffnen“ klicken.",
      );
    }

    const [nodeRes, edgeRes, ruleRes] = await Promise.all([
      supabaseAdmin.from("nodes").select("*").eq("board_id", board.id),
      supabaseAdmin.from("edges").select("*").eq("board_id", board.id),
      supabaseAdmin.from("node_permissions").select("node_id").eq("board_id", board.id),
    ]);
    if (nodeRes.error) throw new Error(nodeRes.error.message);
    if (edgeRes.error) throw new Error(edgeRes.error.message);
    if (ruleRes.error) throw new Error(ruleRes.error.message);

    const all = (nodeRes.data ?? []) as Row[];
    const members = all.filter((row) => {
      if (row["id"] === zone.id) return false;
      if (row["type"] === "zone" || row["type"] === "chat") return false;
      const assigned = metaZoneId(row);
      if (assigned) return assigned === zone.id;
      return inside(row, zone as Row);
    });
    const ids = new Set(members.map((row) => String(row["id"])));
    const edges = ((edgeRes.data ?? []) as Row[]).filter(
      (edge) => ids.has(String(edge["source_id"])) && ids.has(String(edge["target_id"])),
    );

    const { guestView, stripSecrets } = await import("@/lib/guest-view");
    const view = guestView(
      members,
      edges,
      new Set((ruleRes.data ?? []).map((rule) => String(rule.node_id))),
    );

    return {
      board: { id: board.id, title: board.title as string },
      zone: {
        id: zone.id as string,
        title: (zone.title as string | null) ?? "Feld",
        content: (zone.content as string | null) ?? "",
        metadata: stripSecrets(zoneMeta) as unknown as JsonRow,
      },
      nodes: view.nodes as unknown as JsonRow[],
      edges: view.edges as unknown as JsonRow[],
    };
  });
