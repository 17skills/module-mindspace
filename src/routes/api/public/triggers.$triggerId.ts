import { createFileRoute } from "@tanstack/react-router";
import { rateLimit } from "@/lib/rate-limit.server";

/**
 * Ereignis-Eingang: ein fremdes System meldet eine Änderung (Wetterwarnung,
 * Sensor, Ticket, Preis). Der Auslöser prüft zuerst seine Bedingungen und
 * startet den Ablauf nur bei Treffer.
 */
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, content-type, x-trigger-secret",
  "access-control-allow-methods": "POST, OPTIONS",
};

const MAX_BODY = 200_000;

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", ...CORS },
  });
}

export const Route = createFileRoute("/api/public/triggers/$triggerId")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),
      POST: async ({ request, params }) => {
        const id = params.triggerId;
        if (!/^[0-9a-f-]{36}$/i.test(id)) return json({ error: "Unbekannter Auslöser" }, 404);

        const header = request.headers.get("authorization") ?? "";
        const secret =
          (header.startsWith("Bearer ") ? header.slice(7).trim() : "") ||
          (request.headers.get("x-trigger-secret") ?? "").trim();
        if (!secret.startsWith("sbt_")) return json({ error: "Schlüssel fehlt" }, 401);

        const limit = rateLimit(`trigger:${id}`, 120, 60_000);
        if (!limit.ok) {
          return new Response(JSON.stringify({ error: "Zu viele Anfragen" }), {
            status: 429,
            headers: {
              "content-type": "application/json",
              "retry-after": String(limit.retryAfter),
              ...CORS,
            },
          });
        }

        const raw = await request.text();
        if (raw.length > MAX_BODY) return json({ error: "Nachricht zu groß" }, 413);
        let payload: unknown;
        try {
          payload = raw.trim() ? JSON.parse(raw) : {};
        } catch {
          payload = { text: raw.slice(0, 5_000) };
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { hashTriggerSecret, fireTrigger } = await import("@/lib/triggers.server");

        const { data: row } = await supabaseAdmin
          .from("scope_triggers")
          .select(
            "id,board_id,node_id,mode,enabled,interval_minutes,probe_url,match_mode,conditions,last_values,secret_hash,name,log_values,log_exclude",
          )
          .eq("id", id)
          .maybeSingle();

        if (!row || row.secret_hash !== (await hashTriggerSecret(secret))) {
          return json({ error: "Schlüssel ungültig" }, 401);
        }
        if (!row.enabled) return json({ error: "Auslöser ist ausgeschaltet" }, 409);
        if (row.mode === "cron") return json({ error: "Dieser Auslöser nimmt keine Ereignisse an" }, 409);

        const outcome = await fireTrigger(
          supabaseAdmin as never,
          row as never,
          payload,
          "Ereignis von außen",
        );

        return json(
          {
            fired: outcome.fired,
            summary: outcome.evaluation.summary,
            checks: outcome.evaluation.results.map((r) => ({
              path: r.path,
              passed: r.passed,
              reason: r.reason,
            })),
            runs: outcome.runs,
            error: outcome.error,
          },
          outcome.error ? 500 : 200,
        );
      },
    },
  },
});
