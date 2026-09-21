import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser } from "../supabase";

export default defineTool({
  name: "search_content",
  title: "Inhalte durchsuchen",
  description:
    "Search the signed-in user's modules across all boards by title and text, returning matching modules with their board id.",
  inputSchema: {
    query: z.string().trim().min(2).max(200).describe("Search term."),
    board_id: z.string().uuid().nullable().describe("Limit the search to one board. Null searches all boards."),
    limit: z.number().int().min(1).max(50).nullable().describe("Maximum number of results. Null means 20."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ query, board_id, limit }, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    }
    const supabase = supabaseForUser(ctx);
    const safe = query.replace(/[%,()]/g, " ");
    let request = supabase
      .from("nodes")
      .select("id, board_id, type, title, content")
      .or(`title.ilike.%${safe}%,content.ilike.%${safe}%`)
      .limit(limit ?? 20);
    if (board_id) request = request.eq("board_id", board_id);

    const { data, error } = await request;
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    const results = (data ?? []).map((row) => ({
      id: String(row.id),
      boardId: String(row.board_id),
      type: String(row.type ?? ""),
      title: String(row.title ?? ""),
      excerpt: row.content ? String(row.content).slice(0, 500) : null,
    }));
    return {
      content: [{ type: "text", text: JSON.stringify(results, null, 2) }],
      structuredContent: { results },
    };
  },
});
