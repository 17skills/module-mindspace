import { defineTool } from "@lovable.dev/mcp-js";
import { supabaseForUser } from "../supabase";

export default defineTool({
  name: "list_boards",
  title: "Boards auflisten",
  description: "List the boards of the signed-in user with id, title and description.",
  inputSchema: {},
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async (_args, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    }
    const supabase = supabaseForUser(ctx);
    const { data, error } = await supabase
      .from("boards")
      .select("id, title, description, updated_at")
      .order("updated_at", { ascending: false })
      .limit(100);
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    const boards = (data ?? []).map((row) => ({
      id: String(row.id),
      title: String(row.title ?? ""),
      description: row.description ? String(row.description) : null,
      updatedAt: String(row.updated_at ?? ""),
    }));
    return {
      content: [{ type: "text", text: JSON.stringify(boards, null, 2) }],
      structuredContent: { boards },
    };
  },
});
