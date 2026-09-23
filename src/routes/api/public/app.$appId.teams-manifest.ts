// Teams-App-Manifest einer ausgelieferten App: Download für das Teams Admin Center.
import { createFileRoute } from "@tanstack/react-router";
import { loadPublicApp } from "@/lib/app-data.server";
import { buildTeamsManifest } from "@/lib/app-teams";

function appIdFromRequest(request: Request): string | null {
  const parts = new URL(request.url).pathname.split("/").filter(Boolean);
  const index = parts.indexOf("app");
  const id = index >= 0 ? (parts[index + 1] ?? "") : "";
  return /^[0-9a-f-]{36}$/i.test(id) ? id : null;
}

async function handle(ctx: { request: Request }) {
  const appId = appIdFromRequest(ctx.request);
  if (!appId) return new Response("Not found", { status: 404 });
  let app;
  try {
    ({ app } = await loadPublicApp(appId));
    if (app.access_mode !== "public") throw new Error("restricted");
  } catch {
    return new Response("Not found", { status: 404 });
  }
  const url = new URL(ctx.request.url);
  const manifest = buildTeamsManifest({
    appId: app.id,
    title: app.title,
    description: app.description ?? "",
    origin: `${url.protocol}//${url.host}`,
  });
  return new Response(JSON.stringify(manifest, null, 2), {
    headers: {
      "content-type": "application/json",
      "content-disposition": `attachment; filename="teams-manifest-${appId.slice(0, 8)}.json"`,
    },
  });
}

export const Route = createFileRoute("/api/public/app/$appId/teams-manifest")({
  server: { handlers: { GET: handle } },
});
