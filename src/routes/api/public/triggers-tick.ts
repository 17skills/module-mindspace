import { createFileRoute } from "@tanstack/react-router";
import { authenticateCronRequest } from "@/integrations/supabase/cron-auth";

/**
 * Zeitplan: prüft fällige Auslöser, holt die Vergleichsdaten und startet den
 * Ablauf nur, wenn eine Bedingung greift. Ohne Treffer kostet der Takt nichts.
 */
export const Route = createFileRoute("/api/public/triggers-tick")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");

        const cronToken = request.headers.get("x-cron-token") ?? "";
        let allowed = false;
        if (/^[0-9a-f]{64}$/.test(cronToken)) {
          const { data } = await db.rpc("verify_cron_token", {
            _name: "triggers_tick",
            _token: cronToken,
          });
          allowed = data === true;
        }
        if (!allowed) {
          const denied = await authenticateCronRequest(request);
          if (denied) return denied;
        }

        const { data: due, error } = await db
          .from("scope_triggers")
          .select(
            "id,board_id,node_id,mode,enabled,interval_minutes,probe_url,match_mode,conditions,last_values",
          )
          .eq("enabled", true)
          .neq("mode", "webhook")
          .not("interval_minutes", "is", null)
          .lte("next_run_at", new Date().toISOString())
          .limit(50);
        if (error) return new Response(error.message, { status: 500 });

        const { fireTrigger, probePayload } = await import("@/lib/triggers.server");
        const report: { id: string; fired: boolean; summary: string }[] = [];

        for (const row of due ?? []) {
          try {
            const payload = row.probe_url ? await probePayload(row.probe_url) : {};
            const outcome = await fireTrigger(db as never, row as never, payload, "Zeitplan");
            report.push({ id: row.id, fired: outcome.fired, summary: outcome.evaluation.summary });
          } catch (err) {
            const message = err instanceof Error ? err.message : "Abruf fehlgeschlagen";
            await db
              .from("scope_triggers")
              .update({
                last_status: "failed",
                last_detail: message.slice(0, 300),
                last_event_at: new Date().toISOString(),
                next_run_at: new Date(
                  Date.now() + (row.interval_minutes ?? 60) * 60_000,
                ).toISOString(),
              })
              .eq("id", row.id);
            report.push({ id: row.id, fired: false, summary: message });
          }
        }

        return Response.json({ checked: report.length, report });
      },
    },
  },
});
