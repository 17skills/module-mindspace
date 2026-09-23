import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft } from "lucide-react";
import {
  adminEndSessions,
  adminGetUser,
  adminListSessions,
  adminRevokeBoardAccess,
  adminSendPasswordReset,
} from "@/lib/admin-users.functions";
import { adminSetBlocked, adminSetRole } from "@/lib/admin.functions";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/_authenticated/konto/nutzer/$userId")({
  component: UserDetailPage,
});

const ROLE_LABEL: Record<string, string> = {
  owner: "Inhaber",
  admin: "Administrator",
  member: "Mitglied",
  guest: "Gast",
  editor: "Bearbeiten",
  viewer: "Lesen",
};

function UserDetailPage() {
  const { userId } = Route.useParams();
  const client = useQueryClient();
  const user = useQuery({ queryKey: ["admin-user", userId], queryFn: () => adminGetUser({ data: { userId } }) });
  const sessions = useQuery({
    queryKey: ["admin-sessions", userId],
    queryFn: () => adminListSessions({ data: { userId } }),
  });

  const refresh = () => {
    void client.invalidateQueries({ queryKey: ["admin-user", userId] });
    void client.invalidateQueries({ queryKey: ["admin-sessions", userId] });
    void client.invalidateQueries({ queryKey: ["admin-users"] });
  };

  const run = <T,>(fn: (input: T) => Promise<unknown>, message: string) =>
    useMutationLike(fn, message, refresh);

  const block = useMutation({
    mutationFn: (blocked: boolean) => adminSetBlocked({ data: { userId, blocked } }),
    onSuccess: () => {
      toast.success("Gespeichert");
      refresh();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const role = useMutation({
    mutationFn: (isAdmin: boolean) => adminSetRole({ data: { userId, isAdmin } }),
    onSuccess: () => {
      toast.success("Rolle gespeichert");
      refresh();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const reset = useMutation({
    mutationFn: () =>
      adminSendPasswordReset({ data: { email: user.data!.email, origin: window.location.origin } }),
    onSuccess: () => toast.success("Link zum Zurücksetzen verschickt"),
    onError: (error: Error) => toast.error(error.message),
  });

  const endSessions = useMutation({
    mutationFn: (sessionId: string | null) => adminEndSessions({ data: { userId, sessionId } }),
    onSuccess: () => {
      toast.success("Anmeldung beendet");
      refresh();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const revoke = useMutation({
    mutationFn: (memberId: string) => adminRevokeBoardAccess({ data: { memberId } }),
    onSuccess: () => {
      toast.success("Freigabe entzogen");
      refresh();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const data = user.data;
  if (!data) return <p className="text-sm text-muted-foreground">Konto wird geladen …</p>;

  return (
    <div className="space-y-6">
      <Link to="/konto/admin" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        Zurück zur Administration
      </Link>

      <section className="rounded-2xl border bg-card p-6 shadow-[var(--shadow-card)]">
        <div className="flex flex-wrap items-start gap-3">
          <div className="flex-1">
            <h2 className="font-display text-xl font-semibold text-brand-navy">
              {data.displayName || data.email}
            </h2>
            <p className="text-sm text-muted-foreground">{data.email}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Konto seit {new Date(data.createdAt).toLocaleDateString("de-DE")} · zuletzt aktiv{" "}
              {new Date(data.lastActive).toLocaleString("de-DE")}
            </p>
          </div>
          {data.blocked ? <Badge variant="destructive">gesperrt</Badge> : null}
          {data.isAdmin ? <Badge>Administrator</Badge> : null}
        </div>

        <div className="mt-5 flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => role.mutate(!data.isAdmin)}>
            {data.isAdmin ? "Administratorrolle entziehen" : "Zum Administrator machen"}
          </Button>
          <Button variant="outline" onClick={() => block.mutate(!data.blocked)}>
            {data.blocked ? "Konto entsperren" : "Konto sperren"}
          </Button>
          <Button variant="outline" onClick={() => reset.mutate()}>
            Passwort zurücksetzen
          </Button>
          <Button variant="outline" onClick={() => endSessions.mutate(null)}>
            Überall abmelden
          </Button>
        </div>
      </section>

      <section className="rounded-2xl border bg-card p-6 shadow-[var(--shadow-card)]">
        <h3 className="font-display text-lg font-semibold text-brand-navy">Organisationen und Teams</h3>
        <ul className="mt-3 flex flex-wrap gap-2 text-sm">
          {data.orgs.map((entry) => (
            <li key={entry.id} className="rounded-full border px-3 py-1">
              {entry.name} · {ROLE_LABEL[entry.role] ?? entry.role}
            </li>
          ))}
          {data.teams.map((team) => (
            <li key={team.id} className="rounded-full bg-muted px-3 py-1">
              Team {team.name}
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded-2xl border bg-card p-6 shadow-[var(--shadow-card)]">
        <h3 className="font-display text-lg font-semibold text-brand-navy">Scopes und Rechte</h3>
        <ul className="mt-3 divide-y rounded-xl border text-sm">
          {data.ownedScopes.map((scope) => (
            <li key={scope.id} className="flex items-center gap-3 px-4 py-2">
              <span className="flex-1 truncate">{scope.title}</span>
              <Badge variant="secondary">Inhaber</Badge>
            </li>
          ))}
          {data.sharedScopes.map((scope) => (
            <li key={scope.id} className="flex items-center gap-3 px-4 py-2">
              <span className="flex-1 truncate">{scope.title}</span>
              <Badge variant="secondary">{ROLE_LABEL[scope.role] ?? scope.role}</Badge>
              <Button variant="ghost" size="sm" onClick={() => revoke.mutate(scope.id)}>
                Entziehen
              </Button>
            </li>
          ))}
          {!data.ownedScopes.length && !data.sharedScopes.length ? (
            <li className="px-4 py-3 text-muted-foreground">Keine Scopes.</li>
          ) : null}
        </ul>
      </section>

      <section className="rounded-2xl border bg-card p-6 shadow-[var(--shadow-card)]">
        <h3 className="font-display text-lg font-semibold text-brand-navy">Anmeldungen</h3>
        <ul className="mt-3 divide-y rounded-xl border text-sm">
          {(sessions.data ?? []).map((row) => (
            <li key={row.id} className="flex items-center gap-3 px-4 py-2">
              <span className="flex-1 truncate">{row.user_agent ?? "Unbekanntes Gerät"}</span>
              <span className="text-xs text-muted-foreground">
                {new Date(row.created_at).toLocaleString("de-DE")}
              </span>
              <Button variant="ghost" size="sm" onClick={() => endSessions.mutate(row.id)}>
                Beenden
              </Button>
            </li>
          ))}
          {!(sessions.data ?? []).length ? (
            <li className="px-4 py-3 text-muted-foreground">Keine aktiven Anmeldungen.</li>
          ) : null}
        </ul>
      </section>

      <section className="rounded-2xl border bg-card p-6 shadow-[var(--shadow-card)]">
        <h3 className="font-display text-lg font-semibold text-brand-navy">Protokoll</h3>
        <ul className="mt-3 space-y-1 text-sm text-muted-foreground">
          {data.log.map((row) => (
            <li key={row.id}>
              {new Date(row.created_at).toLocaleString("de-DE")} · {row.action}
              {row.detail ? ` · ${row.detail}` : ""}
            </li>
          ))}
          {!data.log.length ? <li>Keine Einträge.</li> : null}
        </ul>
      </section>
    </div>
  );
}
