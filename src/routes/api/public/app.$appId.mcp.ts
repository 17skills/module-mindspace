// Public MCP endpoint for one delivered app: /api/public/app/<appId>/mcp
// External AI clients (Claude Desktop, Copilot, …) connect here with the app
// link; the handler verifies that the app exists and is link-shared.
import { createFileRoute } from "@tanstack/react-router";
import { createTanStackMcpHandler } from "@lovable.dev/mcp-js/stacks/tanstack";
import { loadPublicApp } from "@/lib/app-data.server";
import { buildAppMcp } from "@/lib/app-mcp";

/** One MCP handler per app per runtime instance, so sessions stay stable. */
const handlers = new Map<string, ReturnType<typeof createTanStackMcpHandler>>();

function handlerFor(appId: string) {
  let handler = handlers.get(appId);
  if (!handler) {
    handler = createTanStackMcpHandler(buildAppMcp(appId), {
      resourcePath: `/api/public/app/${appId}/mcp`,
      trustForwardedHost: true,
      trustForwardedProto: true,
    });
    handlers.set(appId, handler);
  }
  return handler;
}

function appIdFromRequest(request: Request): string | null {
  const parts = new URL(request.url).pathname.split("/").filter(Boolean);
  // .../api/public/app/<appId>/mcp
  const index = parts.indexOf("app");
  const id = index >= 0 ? (parts[index + 1] ?? "") : "";
  return /^[0-9a-f-]{36}$/i.test(id) ? id : null;
}

async function handle(ctx: { request: Request }) {
  const appId = appIdFromRequest(ctx.request);
  if (!appId) return new Response("Not found", { status: 404 });
  try {
    await loadPublicApp(appId);
  } catch {
    return new Response("Not found", { status: 404 });
  }
  return handlerFor(appId)({ request: ctx.request });
}

export const Route = createFileRoute("/api/public/app/$appId/mcp")({
  server: {
    handlers: {
      ANY: handle,
    },
  },
});
