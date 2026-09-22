import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser } from "../supabase";

export default defineTool({
  name: "list_zones",
  title: "Felder auflisten",
  description:
    "List the background fields (zones) of one board. Each field bundles the modules lying on it and can be published as its own app.",
  inputSchema: {
    board_id: z.string().uuid().describe("Board id, as returned by list_boards."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ board_id }, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    }
    const supabase = supabaseForUser(ctx);
    const { data, error } = await supabase
      .from("nodes")
      .select("id, type, title, content, position_x, position_y, width, height, metadata")
      .eq("board_id", board_id)
      .limit(500);
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };

    const rows = data ?? [];
    const zones = rows.filter((row) => row.type === "zone");
    const payload = {
      zones: zones.map((zone) => {
        const meta = (zone.metadata ?? {}) as Record<string, unknown>;
        const members = rows.filter((row) => {
          if (row.id === zone.id || row.type === "zone" || row.type === "chat") return false;
          const rowMeta = (row.metadata ?? {}) as Record<string, unknown>;
          const assigned = rowMeta["zoneId"];
          if (typeof assigned === "string" && assigned) return assigned === zone.id;
          const zw = Number(zone.width ?? 420);
          const zh = Number(zone.height ?? 360);
          return (
            Number(row.position_x) >= Number(zone.position_x) &&
            Number(row.position_y) >= Number(zone.position_y) &&
            Number(row.position_x) <= Number(zone.position_x) + zw &&
            Number(row.position_y) <= Number(zone.position_y) + zh
          );
        });
        return {
          id: String(zone.id),
          title: String(zone.title ?? "Feld"),
          note: zone.content ? String(zone.content).slice(0, 500) : null,
          weight: typeof meta["weight"] === "number" ? (meta["weight"] as number) : null,
          agentTask: typeof meta["agentTask"] === "string" ? (meta["agentTask"] as string) : null,
          agentResult:
            typeof meta["agentResult"] === "string" ? (meta["agentResult"] as string) : null,
          moduleCount: members.length,
          moduleTypes: Array.from(new Set(members.map((row) => String(row.type)))),
        };
      }),
    };

    return {
      content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
      structuredContent: payload,
    };
  },
});
