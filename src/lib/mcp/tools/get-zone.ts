import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser } from "../supabase";

export default defineTool({
  name: "get_zone",
  title: "Feld lesen",
  description:
    "Read one background field (zone) as a self-contained bundle: its modules with type, title and text, plus the connections between them.",
  inputSchema: {
    zone_id: z.string().uuid().describe("Field id, as returned by list_zones."),
    max_content_chars: z
      .number()
      .int()
      .min(0)
      .max(20000)
      .nullable()
      .describe("Truncate each module's text to this many characters. Null means 2000."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ zone_id, max_content_chars }, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    }
    const limit = max_content_chars ?? 2000;
    const supabase = supabaseForUser(ctx);

    const zoneRes = await supabase
      .from("nodes")
      .select("id, board_id, type, title, content, position_x, position_y, width, height, metadata")
      .eq("id", zone_id)
      .maybeSingle();
    if (zoneRes.error) {
      return { content: [{ type: "text", text: zoneRes.error.message }], isError: true };
    }
    const zone = zoneRes.data;
    if (!zone || zone.type !== "zone") {
      return { content: [{ type: "text", text: "Field not found or not accessible" }], isError: true };
    }

    const nodes = await supabase
      .from("nodes")
      .select("id, type, title, content, status, position_x, position_y, width, height, metadata")
      .eq("board_id", zone.board_id)
      .limit(500);
    if (nodes.error) return { content: [{ type: "text", text: nodes.error.message }], isError: true };

    const zw = Number(zone.width ?? 420);
    const zh = Number(zone.height ?? 360);
    const members = (nodes.data ?? []).filter((row) => {
      if (row.id === zone.id || row.type === "zone" || row.type === "chat") return false;
      const meta = (row.metadata ?? {}) as Record<string, unknown>;
      const assigned = meta["zoneId"];
      if (typeof assigned === "string" && assigned) return assigned === zone.id;
      return (
        Number(row.position_x) >= Number(zone.position_x) &&
        Number(row.position_y) >= Number(zone.position_y) &&
        Number(row.position_x) <= Number(zone.position_x) + zw &&
        Number(row.position_y) <= Number(zone.position_y) + zh
      );
    });
    const ids = new Set(members.map((row) => String(row.id)));

    const edges = await supabase
      .from("edges")
      .select("id, source_id, target_id, label")
      .eq("board_id", zone.board_id)
      .limit(500);
    if (edges.error) return { content: [{ type: "text", text: edges.error.message }], isError: true };

    const meta = (zone.metadata ?? {}) as Record<string, unknown>;
    const payload = {
      zone: {
        id: String(zone.id),
        boardId: String(zone.board_id),
        title: String(zone.title ?? "Feld"),
        note: zone.content ? String(zone.content).slice(0, limit) : null,
        weight: typeof meta["weight"] === "number" ? (meta["weight"] as number) : null,
        agentTask: typeof meta["agentTask"] === "string" ? (meta["agentTask"] as string) : null,
        agentResult:
          typeof meta["agentResult"] === "string" ? (meta["agentResult"] as string) : null,
      },
      modules: members.map((row) => ({
        id: String(row.id),
        type: String(row.type ?? ""),
        title: String(row.title ?? ""),
        status: String(row.status ?? ""),
        content: row.content ? String(row.content).slice(0, limit) : null,
      })),
      edges: (edges.data ?? [])
        .filter((edge) => ids.has(String(edge.source_id)) && ids.has(String(edge.target_id)))
        .map((edge) => ({
          id: String(edge.id),
          source: String(edge.source_id),
          target: String(edge.target_id),
          label: edge.label ? String(edge.label) : null,
        })),
    };

    return {
      content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
      structuredContent: payload,
    };
  },
});
