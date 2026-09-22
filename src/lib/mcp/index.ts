import { auth, defineMcp } from "@lovable.dev/mcp-js";
import listBoardsTool from "./tools/list-boards";
import getBoardTool from "./tools/get-board";
import createNoteTool from "./tools/create-note";
import searchContentTool from "./tools/search-content";
import listZonesTool from "./tools/list-zones";
import getZoneTool from "./tools/get-zone";

const projectRef = import.meta.env["VITE_SUPABASE_PROJECT_ID"] ?? "project-ref-unset";

export default defineMcp({
  name: "canvas-spark",
  title: "scopebuilder",
  version: "0.1.0",
  instructions:
    "Tools for scopebuilder, a visual knowledge canvas. Use `list_boards` to find the user's boards, `get_board` to read a board's modules and connections, `list_zones` to find the background fields (module bundles) of a board, `get_zone` to read one field as a self-contained app bundle, `search_content` to find modules by text, and `create_note` to add a note to a board.",
  auth: auth.oauth.issuer({
    issuer: `https://${projectRef}.supabase.co/auth/v1`,
    acceptedAudiences: "authenticated",
  }),
  tools: [
    listBoardsTool,
    getBoardTool,
    listZonesTool,
    getZoneTool,
    searchContentTool,
    createNoteTool,
  ],
});
