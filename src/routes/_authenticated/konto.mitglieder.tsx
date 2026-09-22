import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Trash2, UserPlus } from "lucide-react";
import { listMyScopes } from "@/lib/account.functions";
import { addMember, listMembers, removeMember, setMemberRole } from "@/lib/share.functions";
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

export const Route = createFileRoute("/_authenticated/konto/mitglieder")({
  component: MembersPage,
});

const ROLE_LABEL: Record<string, string> = {
  owner: "Inhaber",
  editor: "Bearbeiten",
  viewer: "Lesen",
};

function MembersPage() {
  const client = useQueryClient();
  const scopes = useQuery({ queryKey: ["my-scopes"], queryFn: () => listMyScopes() });
  const [boardId, setBoardId] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"viewer" | "editor">("editor");

  const selected = boardId ?? scopes.data?.owned[0]?.id ?? null;

  const members = useQuery({
    queryKey: ["members", selected],
    enabled: Boolean(selected),
    queryFn: () => listMembers({ data: { boardId: selected as string } }),
  });

  const refresh = () => void client.invalidateQueries({ queryKey: ["members", selected] });

  const invite = useMutation({
    mutationFn: () => addMember({ data: { boardId: selected as string, email, role } }),
    onSuccess: () => {
      toast.success("Mitglied hinzugefügt");
      setEmail("");
      refresh();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const changeRole = useMutation({
    mutationFn: (input: { memberId: string; role: "viewer" | "editor" }) =>
      setMemberRole({ data: { boardId: selected as string, ...input } }),
    onSuccess: refresh,
    onError: (error: Error) => toast.error(error.message),
  });

  const drop = useMutation({
    mutationFn: (memberId: string) =>
      removeMember({ data: { boardId: selected as string, memberId } }),
    onSuccess: () => {
      toast.success("Mitglied entfernt");
      refresh();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border bg-card p-6 shadow-[var(--shadow-card)]">
        <h2 className="font-display text-xl font-semibold text-brand-navy">Mitglieder je Scope</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Nur Inhaber dürfen Rollen ändern. Der Inhaber selbst bleibt immer erhalten.
        </p>

        <div className="mt-5 max-w-sm">
          <Label htmlFor="scope">Scope</Label>
          <Select value={selected ?? ""} onValueChange={setBoardId}>
            <SelectTrigger id="scope" className="mt-1.5">
              <SelectValue placeholder="Scope wählen" />
            </SelectTrigger>
            <SelectContent>
              {(scopes.data?.owned ?? []).map((scope) => (
                <SelectItem key={scope.id} value={scope.id}>
                  {scope.title} · {scope.members} Mitglieder
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="mt-6 flex flex-wrap items-end gap-2">
          <div className="min-w-[16rem] flex-1">
            <Label htmlFor="invite">Person einladen (E-Mail)</Label>
            <Input
              id="invite"
              type="email"
              value={email}
              placeholder="name@firma.de"
              onChange={(event) => setEmail(event.target.value)}
            />
          </div>
          <Select value={role} onValueChange={(next) => setRole(next as "viewer" | "editor")}>
            <SelectTrigger className="w-40" aria-label="Rolle">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="editor">Bearbeiten</SelectItem>
              <SelectItem value="viewer">Lesen</SelectItem>
            </SelectContent>
          </Select>
          <Button onClick={() => invite.mutate()} disabled={!selected || !email || invite.isPending}>
            <UserPlus className="mr-1.5 h-4 w-4" aria-hidden="true" />
            Hinzufügen
          </Button>
        </div>

        <ul className="mt-6 divide-y rounded-xl border">
          {(members.data ?? []).map((member) => (
            <li key={member.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
              <span className="text-sm">{member.email}</span>
              <div className="flex items-center gap-2">
                <Select
                  value={member.role === "viewer" ? "viewer" : "editor"}
                  onValueChange={(next) =>
                    changeRole.mutate({ memberId: member.id, role: next as "viewer" | "editor" })
                  }
                >
                  <SelectTrigger className="w-36" aria-label={`Rolle von ${member.email}`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="editor">Bearbeiten</SelectItem>
                    <SelectItem value="viewer">Lesen</SelectItem>
                  </SelectContent>
                </Select>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`${member.email} entfernen`}
                  onClick={() => drop.mutate(member.id)}
                >
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                </Button>
              </div>
            </li>
          ))}
          {members.data && members.data.length === 0 ? (
            <li className="px-4 py-6 text-sm text-muted-foreground">
              Noch keine weiteren Mitglieder in diesem Scope.
            </li>
          ) : null}
        </ul>
      </section>

      <section className="rounded-2xl border bg-card p-6 shadow-[var(--shadow-card)]">
        <h2 className="font-display text-xl font-semibold text-brand-navy">
          Scopes, in denen du Mitglied bist
        </h2>
        <ul className="mt-4 divide-y rounded-xl border">
          {(scopes.data?.joined ?? []).map((scope) => (
            <li key={scope.id} className="flex items-center justify-between gap-3 px-4 py-3">
              <Link to="/board/$boardId" params={{ boardId: scope.id }} className="text-sm underline-offset-4 hover:underline">
                {scope.title}
              </Link>
              <Badge variant="secondary">{ROLE_LABEL[scope.role] ?? scope.role}</Badge>
            </li>
          ))}
          {scopes.data && scopes.data.joined.length === 0 ? (
            <li className="px-4 py-6 text-sm text-muted-foreground">
              Du wurdest bisher zu keinem fremden Scope eingeladen.
            </li>
          ) : null}
        </ul>
      </section>
    </div>
  );
}
