import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import { deleteTeam, getOrg, saveTeam, setTeamMember } from "@/lib/org.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";

export const Route = createFileRoute("/_authenticated/konto/teams")({
  component: TeamsPage,
});

function TeamsPage() {
  const client = useQueryClient();
  const org = useQuery({ queryKey: ["org"], queryFn: () => getOrg({ data: {} }) });
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  const refresh = () => client.invalidateQueries({ queryKey: ["org"] });

  const create = useMutation({
    mutationFn: () => saveTeam({ data: { orgId: org.data!.id, name, description } }),
    onSuccess: () => {
      toast.success("Team angelegt");
      setName("");
      setDescription("");
      void refresh();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const drop = useMutation({
    mutationFn: (teamId: string) => deleteTeam({ data: { orgId: org.data!.id, teamId } }),
    onSuccess: () => {
      toast.success("Team gelöscht");
      void refresh();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const toggle = useMutation({
    mutationFn: (input: { teamId: string; userId: string; member: boolean }) =>
      setTeamMember({ data: { orgId: org.data!.id, ...input } }),
    onSuccess: () => void refresh(),
    onError: (error: Error) => toast.error(error.message),
  });

  const data = org.data;
  const manage = Boolean(data?.canManage);

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border bg-card p-6 shadow-[var(--shadow-card)]">
        <h2 className="font-display text-xl font-semibold text-brand-navy">Teams</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Teams bündeln Personen. Ein Team kann als Ganzes zu einem Scope eingeladen werden.
        </p>

        {manage ? (
          <form
            className="mt-5 grid gap-3 sm:grid-cols-[1fr_1fr_auto]"
            onSubmit={(event) => {
              event.preventDefault();
              create.mutate();
            }}
          >
            <div>
              <Label htmlFor="team-name">Name</Label>
              <Input id="team-name" className="mt-1.5" value={name} onChange={(event) => setName(event.target.value)} />
            </div>
            <div>
              <Label htmlFor="team-desc">Beschreibung</Label>
              <Input
                id="team-desc"
                className="mt-1.5"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
              />
            </div>
            <Button type="submit" className="self-end" disabled={create.isPending || name.trim().length < 2}>
              <Plus className="mr-1.5 h-4 w-4" aria-hidden="true" />
              Team anlegen
            </Button>
          </form>
        ) : null}
      </section>

      {(data?.teams ?? []).map((team) => (
        <section key={team.id} className="rounded-2xl border bg-card p-6 shadow-[var(--shadow-card)]">
          <div className="flex items-start gap-3">
            <div className="flex-1">
              <h3 className="font-display text-lg font-semibold text-brand-navy">{team.name}</h3>
              {team.description ? <p className="text-sm text-muted-foreground">{team.description}</p> : null}
            </div>
            {manage ? (
              <Button variant="ghost" size="sm" onClick={() => drop.mutate(team.id)}>
                <Trash2 className="h-4 w-4" aria-hidden="true" />
                <span className="sr-only">Team löschen</span>
              </Button>
            ) : null}
          </div>

          <ul className="mt-4 grid gap-2 sm:grid-cols-2">
            {(data?.members ?? []).map((member) => {
              const inTeam = team.memberIds.includes(member.userId);
              return (
                <li key={member.userId} className="flex items-center gap-3 rounded-xl border px-3 py-2 text-sm">
                  <Checkbox
                    id={`${team.id}-${member.userId}`}
                    checked={inTeam}
                    disabled={!manage}
                    onCheckedChange={(checked) =>
                      toggle.mutate({ teamId: team.id, userId: member.userId, member: checked === true })
                    }
                  />
                  <label htmlFor={`${team.id}-${member.userId}`} className="min-w-0 flex-1 truncate">
                    {member.displayName || member.email}
                  </label>
                </li>
              );
            })}
          </ul>
        </section>
      ))}

      {!(data?.teams ?? []).length ? (
        <p className="rounded-2xl border border-dashed p-6 text-sm text-muted-foreground">
          Noch keine Teams angelegt.
        </p>
      ) : null}
    </div>
  );
}
