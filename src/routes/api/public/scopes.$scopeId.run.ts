import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { rateLimit } from "@/lib/rate-limit.server";

/**
 * Headless-Start eines Scopes durch fremde Systeme (z. B. n8n, SAP, CI).
 * Zugang nur mit einem Scope-Schlüssel; der Ablauf ist derselbe wie in der App,
 * jeder Durchlauf landet unveränderlich in der Durchlauf-Ablage.
 */
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, content-type",
  "access-control-allow-methods": "POST, OPTIONS",
};

const Body = z.object({
  start: z.string().uuid(),
  input: z.record(z.string(), z.union([z.string().max(200), z.number()])).default({}),
});

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", ...CORS },
  });
}

async function hashKey(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(`scopebuilder-api:${value}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

export const Route = createFileRoute("/api/public/scopes/$scopeId/run")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),
      POST: async ({ request, params }) => {
        const boardId = params.scopeId;
        if (!/^[0-9a-f-]{36}$/i.test(boardId)) return json({ error: "Unbekannter Scope" }, 404);

        const header = request.headers.get("authorization") ?? "";
        const secret = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
        if (!secret.startsWith("sbk_")) return json({ error: "Schlüssel fehlt" }, 401);

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: key } = await supabaseAdmin
          .from("api_keys")
          .select("id,board_id,revoked_at")
          .eq("key_hash", await hashKey(secret))
          .maybeSingle();
        if (!key || key.revoked_at || key.board_id !== boardId) {
          return json({ error: "Schlüssel ungültig" }, 401);
        }

        const limit = rateLimit(`scope-run:${key.id}`, 60, 60_000);
        if (!limit.ok) {
          return new Response(JSON.stringify({ error: "Zu viele Anfragen" }), {
            status: 429,
            headers: { "content-type": "application/json", "retry-after": String(limit.retryAfter), ...CORS },
          });
        }

        let body: z.infer<typeof Body>;
        try {
          body = Body.parse(await request.json());
        } catch {
          return json({ error: "Ungültige Anfrage" }, 400);
        }

        const { data: start } = await supabaseAdmin
          .from("nodes")
          .select("id,board_id")
          .eq("id", body.start)
          .maybeSingle();
        if (!start || start.board_id !== boardId) {
          return json({ error: "Startmodul gehört nicht zu diesem Scope" }, 400);
        }

        try {
          const { runFlow } = await import("@/lib/flow-run.server");
          const result = await runFlow({
            db: supabaseAdmin as never,
            boardId,
            appId: null,
            startNodeId: body.start,
            userId: null,
            values: body.input,
            origin: "api",
            apiKeyId: key.id,
            actorLabel: "Schnittstelle",
          });
          await supabaseAdmin
            .from("api_keys")
            .update({ last_used_at: new Date().toISOString() })
            .eq("id", key.id);
          return json({
            input: result.input,
            steps: result.steps.map((s) => ({
              module: s.title,
              status: s.status,
              error: s.error,
              points: s.points.length,
            })),
            results: result.outputs.map((o) => ({ runId: o.runId, text: o.text })),
          });
        } catch (error) {
          console.error("headless run", error);
          return json({ error: "Durchlauf fehlgeschlagen" }, 500);
        }
      },
    },
  },
});
