// Public MCP endpoint for one delivered app: /api/public/app/<appId>/mcp
// External AI clients (Claude Desktop, Copilot, …) connect here. Access needs
// the app's key, either as `Authorization: Bearer <key>` or as `?token=<key>`.
import { createFileRoute } from "@tanstack/react-router";
import { createTanStackMcpHandler } from "@lovable.dev/mcp-js/stacks/tanstack";
import { authorizeAppMcp, type McpScope } from "@/lib/app-data.server";
import { buildAppMcp } from "@/lib/app-mcp";

/** One MCP handler per app and scope per runtime instance, so sessions stay stable. */
const handlers = new Map<string, ReturnType<typeof createTanStackMcpHandler>>();

function handlerFor(appId: string, scope: McpScope) {
  const key = `${appId}:${scope}`;
  let handler = handlers.get(key);
  if (!handler) {
    handler = createTanStackMcpHandler(buildAppMcp(appId, scope), {
      resourcePath: `/api/public/app/${appId}/mcp`,
      trustForwardedHost: true,
      trustForwardedProto: true,
    });
    handlers.set(key, handler);
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
  const access = await authorizeAppMcp(appId, ctx.request);
  if (!access.ok) {
    if (access.status === 404) return new Response("Not found", { status: 404 });
    if (access.status === 429) {
      return new Response(
        JSON.stringify({ error: "rate_limited", message: "Too many requests. Try again later." }),
        { status: 429, headers: { "content-type": "application/json", "retry-after": "60" } },
      );
    }
    return new Response(
      JSON.stringify({
        error: "unauthorized",
        message:
          "Missing or invalid access key. Send it as 'Authorization: Bearer <key>' or append '?token=<key>'.",
      }),
      {
        status: 401,
        headers: {
          "content-type": "application/json",
          "www-authenticate": 'Bearer realm="scopebuilder-app"',
        },
      },
    );
  }
  return handlerFor(appId, access.scope)({ request: ctx.request });
}

export const Route = createFileRoute("/api/public/app/$appId/mcp")({
  server: {
    handlers: {
      ANY: handle,
    },
  },
});
