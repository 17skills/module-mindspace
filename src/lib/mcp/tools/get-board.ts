import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser } from "../supabase";

export default defineTool({
  name: "get_board",
  title: "Board lesen",
  description:
    "Read one board of the signed-in user: its modules (nodes) with type, title and text content, plus the connections between them.",
  inputSchema: {
    board_id: z.string().uuid().describe("Board id, as returned by list_boards."),
    max_content_chars: z
      .number()
      .int()
      .min(0)
      .max(20000)
      .nullable()
      .describe("Truncate each module's text to this many characters. Null means 2000."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ board_id, max_content_chars }, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    }
    const limit = max_content_chars ?? 2000;
    const supabase = supabaseForUser(ctx);

    const board = await supabase
      .from("boards")
      .select("id, title, description")
      .eq("id", board_id)
      .maybeSingle();
    if (board.error) return { content: [{ type: "text", text: board.error.message }], isError: true };
    if (!board.data) {
      return { content: [{ type: "text", text: "Board not found or not accessible" }], isError: true };
    }

    const nodes = await supabase
      .from("nodes")
      .select("id, type, title, content, status")
      .eq("board_id", board_id)
      .limit(500);
    if (nodes.error) return { content: [{ type: "text", text: nodes.error.message }], isError: true };

    const edges = await supabase
      .from("edges")
      .select("id, source_id, target_id, label")
      .eq("board_id", board_id)
      .limit(500);
    if (edges.error) return { content: [{ type: "text", text: edges.error.message }], isError: true };

    const payload = {
      board: {
        id: String(board.data.id),
        title: String(board.data.title ?? ""),
        description: board.data.description ? String(board.data.description) : null,
      },
      nodes: (nodes.data ?? []).map((row) => ({
        id: String(row.id),
        type: String(row.type ?? ""),
        title: String(row.title ?? ""),
        status: String(row.status ?? ""),
        content: row.content ? String(row.content).slice(0, limit) : null,
      })),
      edges: (edges.data ?? []).map((row) => ({
        id: String(row.id),
        source: String(row.source_id),
        target: String(row.target_id),
        label: row.label ? String(row.label) : null,
      })),
    };

    return {
      content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
      structuredContent: payload,
    };
  },
});
