import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Copy, LogOut, Mail, RefreshCw, Trash2 } from "lucide-react";
import {
  getOrg,
  leaveOrg,
  listMyOrgs,
  removeOrgMember,
  renameOrg,
  setActiveOrg,
  setOrgRole,
} from "@/lib/org.functions";
import { createInvite, resendInvite, revokeInvite } from "@/lib/invites.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export const Route = createFileRoute("/_authenticated/konto/organisation")({
  component: OrgPage,
});

const ORG_ROLES = [
  { value: "owner", label: "Inhaber" },
  { value: "admin", label: "Administrator" },
  { value: "member", label: "Mitglied" },
  { value: "guest", label: "Gast" },
] as const;

const ROLE_LABEL: Record<string, string> = {
  owner: "Inhaber",
  admin: "Administrator",
  member: "Mitglied",
  guest: "Gast",
};

function origin() {
  return typeof window === "undefined" ? "https://scopebuilder.app" : window.location.origin;
}

function OrgPage() {
  const client = useQueryClient();
  const orgs = useQuery({ queryKey: ["my-orgs"], queryFn: () => listMyOrgs() });
  const org = useQuery({ queryKey: ["org"], queryFn: () => getOrg({ data: {} }) });

  const [name, setName] = useState("");
  const [emails, setEmails] = useState("");
  const [inviteRole, setInviteRole] = useState<"admin" | "member" | "guest">("member");
  const [inviteTeam, setInviteTeam] = useState<string>("none");

  const refresh = () => {
    void client.invalidateQueries({ queryKey: ["org"] });
    void client.invalidateQueries({ queryKey: ["my-orgs"] });
  };

  const switchOrg = useMutation({
    mutationFn: (orgId: string) => setActiveOrg({ data: { orgId } }),
    onSuccess: refresh,
    onError: (error: Error) => toast.error(error.message),
  });

  const rename = useMutation({
    mutationFn: () => renameOrg({ data: { orgId: org.data!.id, name } }),
    onSuccess: () => {
      toast.success("Name gespeichert");
      setName("");
      refresh();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const invite = useMutation({
    mutationFn: () =>
      createInvite({
        data: {
          orgId: org.data!.id,
          emails: emails
            .split(/[,;\s]+/)
            .map((value) => value.trim())
            .filter(Boolean),
          orgRole: inviteRole,
          teamId: inviteTeam === "none" ? null : inviteTeam,
          origin: origin(),
        },
      }),
    onSuccess: (result) => {
      const unsent = result.results.filter((row) => !row.sent).length;
      toast.success(
        unsent
          ? `${result.results.length} Einladung(en) erstellt – ${unsent} ohne E-Mail-Versand, bitte Link kopieren`
          : `${result.results.length} Einladung(en) verschickt`,
      );
      setEmails("");
      refresh();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const changeRole = useMutation({
    mutationFn: (input: { userId: string; role: "owner" | "admin" | "member" | "guest" }) =>
      setOrgRole({ data: { orgId: org.data!.id, ...input } }),
    onSuccess: refresh,
    onError: (error: Error) => toast.error(error.message),
  });

  const drop = useMutation({
    mutationFn: (userId: string) => removeOrgMember({ data: { orgId: org.data!.id, userId } }),
    onSuccess: () => {
      toast.success("Mitglied entfernt");
      refresh();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const leave = useMutation({
    mutationFn: () => leaveOrg({ data: { orgId: org.data!.id } }),
    onSuccess: () => {
      toast.success("Organisation verlassen");
      refresh();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const again = useMutation({
    mutationFn: (inviteId: string) => resendInvite({ data: { inviteId, origin: origin() } }),
    onSuccess: (result) =>
      result.sent ? toast.success("Einladung erneut verschickt") : toast.message("Bitte Link kopieren und weitergeben"),
    onError: (error: Error) => toast.error(error.message),
  });

  const pull = useMutation({
    mutationFn: (inviteId: string) => revokeInvite({ data: { inviteId } }),
    onSuccess: () => {
      toast.success("Einladung zurückgezogen");
      refresh();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const data = org.data;
  const manage = Boolean(data?.canManage);

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border bg-card p-6 shadow-[var(--shadow-card)]">
        <h2 className="font-display text-xl font-semibold text-brand-navy">Organisation</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Konten, Rechte und Scopes gehören zu einer Organisation. Deine Rolle:{" "}
          <strong>{ROLE_LABEL[data?.myRole ?? "member"]}</strong>
        </p>

        {(orgs.data?.orgs.length ?? 0) > 1 ? (
          <div className="mt-5 max-w-sm">
            <Label htmlFor="org-switch">Aktive Organisation</Label>
            <Select value={orgs.data?.activeOrgId ?? ""} onValueChange={(value) => switchOrg.mutate(value)}>
              <SelectTrigger id="org-switch" className="mt-1.5">
                <SelectValue placeholder="Organisation wählen" />
              </SelectTrigger>
              <SelectContent>
                {(orgs.data?.orgs ?? []).map((entry) => (
                  <SelectItem key={entry.id} value={entry.id}>
                    {entry.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : null}

        {manage ? (
          <form
            className="mt-5 flex max-w-lg items-end gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              rename.mutate();
            }}
          >
            <div className="flex-1">
              <Label htmlFor="org-name">Name</Label>
              <Input
                id="org-name"
                className="mt-1.5"
                value={name || data?.name || ""}
                onChange={(event) => setName(event.target.value)}
              />
            </div>
            <Button type="submit" disabled={rename.isPending}>
              Speichern
            </Button>
          </form>
        ) : null}
      </section>

      {manage ? (
        <section className="rounded-2xl border bg-card p-6 shadow-[var(--shadow-card)]">
          <h3 className="font-display text-lg font-semibold text-brand-navy">Personen einladen</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Mehrere Adressen durch Komma oder Leerzeichen trennen. Der Link gilt 14 Tage.
          </p>
          <form
            className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto_auto_auto]"
            onSubmit={(event) => {
              event.preventDefault();
              invite.mutate();
            }}
          >
            <Input
              placeholder="name@firma.de"
              value={emails}
              onChange={(event) => setEmails(event.target.value)}
              aria-label="E-Mail-Adressen"
            />
            <Select value={inviteRole} onValueChange={(value) => setInviteRole(value as typeof inviteRole)}>
              <SelectTrigger className="w-40" aria-label="Rolle">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ORG_ROLES.filter((role) => role.value !== "owner").map((role) => (
                  <SelectItem key={role.value} value={role.value}>
                    {role.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={inviteTeam} onValueChange={setInviteTeam}>
              <SelectTrigger className="w-44" aria-label="Team">
                <SelectValue placeholder="Ohne Team" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Ohne Team</SelectItem>
                {(data?.teams ?? []).map((team) => (
                  <SelectItem key={team.id} value={team.id}>
                    {team.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button type="submit" disabled={invite.isPending || !emails.trim()}>
              <Mail className="mr-1.5 h-4 w-4" aria-hidden="true" />
              Einladen
            </Button>
          </form>

          {(data?.invites ?? []).filter((row) => row.status === "pending").length ? (
            <ul className="mt-5 divide-y rounded-xl border">
              {(data?.invites ?? [])
                .filter((row) => row.status === "pending")
                .map((row) => (
                  <li key={row.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
                    <span className="flex-1 truncate">{row.email}</span>
                    <Badge variant="secondary">{ROLE_LABEL[row.role]}</Badge>
                    <span className="text-xs text-muted-foreground">
                      {row.emailSentAt ? "verschickt" : "noch nicht verschickt"} · läuft ab{" "}
                      {new Date(row.expiresAt).toLocaleDateString("de-DE")}
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        void navigator.clipboard.writeText(`${origin()}/einladung/${row.token}`);
                        toast.success("Link kopiert");
                      }}
                    >
                      <Copy className="h-4 w-4" aria-hidden="true" />
                      <span className="sr-only">Link kopieren</span>
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => again.mutate(row.id)}>
                      <RefreshCw className="h-4 w-4" aria-hidden="true" />
                      <span className="sr-only">Erneut senden</span>
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => pull.mutate(row.id)}>
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                      <span className="sr-only">Zurückziehen</span>
                    </Button>
                  </li>
                ))}
            </ul>
          ) : null}
        </section>
      ) : null}

      <section className="rounded-2xl border bg-card p-6 shadow-[var(--shadow-card)]">
        <h3 className="font-display text-lg font-semibold text-brand-navy">Mitglieder</h3>
        <ul className="mt-4 divide-y rounded-xl border">
          {(data?.members ?? []).map((member) => (
            <li key={member.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{member.displayName || member.email}</p>
                <p className="truncate text-xs text-muted-foreground">{member.email}</p>
              </div>
              {member.blocked ? <Badge variant="destructive">gesperrt</Badge> : null}
              {manage ? (
                <Select
                  value={member.role}
                  onValueChange={(value) =>
                    changeRole.mutate({ userId: member.userId, role: value as "owner" | "admin" | "member" | "guest" })
                  }
                >
                  <SelectTrigger className="w-44" aria-label={`Rolle von ${member.email}`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ORG_ROLES.map((role) => (
                      <SelectItem key={role.value} value={role.value}>
                        {role.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Badge variant="secondary">{ROLE_LABEL[member.role]}</Badge>
              )}
              {manage ? (
                <Button variant="ghost" size="sm" onClick={() => drop.mutate(member.userId)}>
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                  <span className="sr-only">Entfernen</span>
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded-2xl border bg-card p-6 shadow-[var(--shadow-card)]">
        <h3 className="font-display text-lg font-semibold text-brand-navy">Meine Organisationen</h3>
        <ul className="mt-4 space-y-2 text-sm">
          {(orgs.data?.orgs ?? []).map((entry) => (
            <li key={entry.id} className="flex items-center gap-3 rounded-xl border px-4 py-3">
              <span className="flex-1 truncate">{entry.name}</span>
              <Badge variant="secondary">{ROLE_LABEL[entry.role]}</Badge>
              {entry.id === data?.id ? (
                <Button variant="ghost" size="sm" onClick={() => leave.mutate()}>
                  <LogOut className="mr-1.5 h-4 w-4" aria-hidden="true" />
                  Verlassen
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
