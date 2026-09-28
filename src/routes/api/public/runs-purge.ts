import { createFileRoute } from "@tanstack/react-router";
import { authenticateCronRequest } from "@/integrations/supabase/cron-auth";

/**
 * Täglich: abgelaufene Durchläufe bereinigen. Eingabedatei löschen, Personenbezug
 * entfernen, Nachweis (Prüfsummen, Motor, Zeit) bleibt. Jeder Schritt wird protokolliert.
 */
export const Route = createFileRoute("/api/public/runs-purge")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
        // Zeitplan in der Datenbank sendet ein Token, das die Datenbank nie verlässt.
        const cronToken = request.headers.get("x-cron-token") ?? "";
        let allowed = false;
        if (/^[0-9a-f]{64}$/.test(cronToken)) {
          const { data } = await db.rpc("verify_cron_token", { _name: "runs_purge", _token: cronToken });
          allowed = data === true;
        }
        if (!allowed) {
          const denied = await authenticateCronRequest(request);
          if (denied) return denied;
        }
        const { data: due, error } = await db
          .from("runs")
          .select("id,board_id,input_path")
          .is("purged_at", null)
          .lt("expires_at", new Date().toISOString())
          .limit(500);
        if (error) return new Response(error.message, { status: 500 });

        const paths = (due ?? []).map((r) => r.input_path).filter(Boolean) as string[];
        if (paths.length) await db.storage.from("uploads").remove(paths);
        for (const run of due ?? []) {
          await db
            .from("runs")
            .update({ user_id: null, input_path: null, purged_at: new Date().toISOString() })
            .eq("id", run.id);
          await db.from("run_events").insert({
            run_id: run.id,
            board_id: run.board_id,
            actor_id: null,
            action: "purged",
            detail: run.input_path ? "Eingabedatei gelöscht, Person entfernt" : "Person entfernt",
          });
        }
        return Response.json({ purged: due?.length ?? 0 });
      },
    },
  },
});
