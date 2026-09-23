// Entscheidungskarte einer ausgelieferten App für Microsoft Teams.
// GET  → Adaptive Card als JSON (Schlüssel der App nötig).
// POST → dieselbe Karte an einen eingehenden Teams-Webhook senden.
import { createFileRoute } from "@tanstack/react-router";
import { admin, authorizeAppMcp } from "@/lib/app-data.server";
import { buildAdaptiveCard, buildWebhookPayload, type TeamsCardInput } from "@/lib/app-teams";
import { appSummary } from "@/lib/app-summary.server";

function appIdFromRequest(request: Request): string | null {
  const parts = new URL(request.url).pathname.split("/").filter(Boolean);
  const index = parts.indexOf("app");
  const id = index >= 0 ? (parts[index + 1] ?? "") : "";
  return /^[0-9a-f-]{36}$/i.test(id) ? id : null;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function cardInputFor(request: Request, appId: string): Promise<TeamsCardInput> {
  const url = new URL(request.url);
  const summary = await appSummary(appId);
  const db = await admin();
  const { data } = await db.from("apps").select("lead_question").eq("id", appId).maybeSingle();
  return {
    title: summary.title,
    headline: summary.headline,
    signal: summary.signal,
    description: summary.description,
    boardTitle: summary.boardTitle,
    leadQuestion: String((data as { lead_question?: string } | null)?.lead_question ?? ""),
    metrics: summary.metrics,
    appUrl: `${url.protocol}//${url.host}/app/${appId}`,
    updatedAt: summary.updatedAt,
  };
}

async function handle(ctx: { request: Request }) {
  const appId = appIdFromRequest(ctx.request);
  if (!appId) return new Response("Not found", { status: 404 });

  const access = await authorizeAppMcp(appId, ctx.request);
  if (!access.ok) {
    if (access.status === 404) return new Response("Not found", { status: 404 });
    if (access.status === 429) return json({ error: "rate_limited" }, 429);
    return json(
      {
        error: "unauthorized",
        message:
          "Schlüssel der App fehlt. Als 'Authorization: Bearer <key>' senden oder '?token=<key>' anhängen.",
      },
      401,
    );
  }

  const input = await cardInputFor(ctx.request, appId);

  if (ctx.request.method === "POST") {
    let webhook = "";
    try {
      const body = (await ctx.request.json()) as { webhook?: unknown };
      webhook = typeof body.webhook === "string" ? body.webhook : "";
    } catch {
      webhook = "";
    }
    if (!/^https:\/\/\S+$/.test(webhook)) {
      return json({ error: "invalid_webhook", message: "Bitte eine https-Adresse senden." }, 400);
    }
    const response = await fetch(webhook, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(buildWebhookPayload(input)),
    });
    if (!response.ok) {
      const text = await response.text();
      return json({ error: "webhook_failed", status: response.status, body: text }, 502);
    }
    return json({ ok: true });
  }

  return json(buildAdaptiveCard(input));
}

export const Route = createFileRoute("/api/public/app/$appId/teams-card")({
  server: { handlers: { GET: handle, POST: handle } },
});
