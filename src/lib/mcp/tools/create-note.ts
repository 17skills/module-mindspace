import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser } from "../supabase";

export default defineTool({
  name: "create_note",
  title: "Notiz anlegen",
  description: "Add a note module with a title and text to one of the signed-in user's boards.",
  inputSchema: {
    board_id: z.string().uuid().describe("Board id, as returned by list_boards."),
    title: z.string().trim().min(1).max(200).describe("Short title of the note."),
    content: z.string().max(20000).describe("Body text of the note."),
    position_x: z.number().nullable().describe("Canvas x position. Null places it at 0."),
    position_y: z.number().nullable().describe("Canvas y position. Null places it at 0."),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  handler: async ({ board_id, title, content, position_x, position_y }, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    }
    const supabase = supabaseForUser(ctx);
    const { data, error } = await supabase
      .from("nodes")
      .insert({
        board_id,
        type: "note",
        title,
        content,
        status: "ready",
        position_x: position_x ?? 0,
        position_y: position_y ?? 0,
      })
      .select("id, title")
      .maybeSingle();
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    const note = { id: String(data?.id ?? ""), title: String(data?.title ?? title) };
    return {
      content: [{ type: "text", text: `Notiz angelegt: ${note.title} (${note.id})` }],
      structuredContent: { note },
    };
  },
});
