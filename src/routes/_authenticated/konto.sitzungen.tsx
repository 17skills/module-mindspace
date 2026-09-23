import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { endMySessions, listMySessions } from "@/lib/admin-users.functions";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_authenticated/konto/sitzungen")({
  component: SessionsPage,
});

function device(agent: string | null) {
  if (!agent) return "Unbekanntes Gerät";
  if (/iPhone|Android|Mobile/i.test(agent)) return "Mobilgerät";
  if (/Mac/i.test(agent)) return "Mac";
  if (/Windows/i.test(agent)) return "Windows-Rechner";
  return "Browser";
}

function SessionsPage() {
  const client = useQueryClient();
  const sessions = useQuery({ queryKey: ["my-sessions"], queryFn: () => listMySessions() });

  const end = useMutation({
    mutationFn: (sessionId: string | null) => endMySessions({ data: { sessionId } }),
    onSuccess: () => {
      toast.success("Anmeldung beendet");
      void client.invalidateQueries({ queryKey: ["my-sessions"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <section className="rounded-2xl border bg-card p-6 shadow-[var(--shadow-card)]">
      <div className="flex flex-wrap items-start gap-3">
        <div className="flex-1">
          <h2 className="font-display text-xl font-semibold text-brand-navy">Meine Anmeldungen</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Angemeldete Geräte. Es werden weder IP-Adressen noch Standorte gespeichert.
          </p>
        </div>
        <Button variant="outline" onClick={() => end.mutate(null)} disabled={end.isPending}>
          Überall abmelden
        </Button>
      </div>

      <ul className="mt-5 divide-y rounded-xl border">
        {(sessions.data ?? []).map((row) => (
          <li key={row.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
            <div className="min-w-0 flex-1">
              <p className="font-medium">{device(row.user_agent)}</p>
              <p className="text-xs text-muted-foreground">
                angemeldet am {new Date(row.created_at).toLocaleString("de-DE")}
                {row.refreshed_at ? ` · zuletzt aktiv ${new Date(row.refreshed_at).toLocaleString("de-DE")}` : ""}
              </p>
            </div>
            <Button variant="ghost" size="sm" onClick={() => end.mutate(row.id)}>
              Beenden
            </Button>
          </li>
        ))}
        {!(sessions.data ?? []).length ? (
          <li className="px-4 py-6 text-sm text-muted-foreground">Keine aktiven Anmeldungen gefunden.</li>
        ) : null}
      </ul>
    </section>
  );
}
