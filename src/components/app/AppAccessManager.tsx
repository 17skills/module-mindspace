import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { getAppAccessConfig, setAppAccessMode, setAppPermission } from "@/lib/app-permissions.functions";
import type { AppAccessMode, AppRole } from "@/lib/app-permissions.server";

type Config = Awaited<ReturnType<typeof getAppAccessConfig>>;
const NONE = "none";

export function AppAccessManager({ appId }: { appId: string }) {
  const [config, setConfig] = useState<Config | null>(null);
  const [busy, setBusy] = useState(false);
  const load = () => getAppAccessConfig({ data: { appId } }).then(setConfig).catch((error: unknown) => {
    toast.error(error instanceof Error ? error.message : "Freigaben konnten nicht geladen werden");
  });
  useEffect(() => { void load(); }, [appId]);

  const grantFor = (type: "user" | "team", id: string) =>
    config?.grants.find((grant) => grant.subject_type === type && grant.subject_id === id)?.role ?? NONE;
  const changeMode = async (mode: AppAccessMode) => {
    setBusy(true);
    try {
      await setAppAccessMode({ data: { appId, mode } });
      await load();
      toast.success("Zugriffsart gespeichert");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Zugriff konnte nicht gespeichert werden");
    } finally { setBusy(false); }
  };
  const changeGrant = async (subjectType: "user" | "team", subjectId: string, value: string) => {
    setBusy(true);
    try {
      await setAppPermission({ data: { appId, subjectType, subjectId, role: value === NONE ? null : value as AppRole } });
      await load();
      toast.success(value === NONE ? "Freigabe entfernt" : "Rolle gespeichert");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Rolle konnte nicht gespeichert werden");
    } finally { setBusy(false); }
  };
  if (!config) return <p className="text-xs text-muted-foreground">Freigaben werden geladen …</p>;
  const roleSelect = (type: "user" | "team", id: string, label: string) => (
    <Select disabled={busy} value={grantFor(type, id)} onValueChange={(value) => void changeGrant(type, id, value)}>
      <SelectTrigger className="w-44" aria-label={`Rolle für ${label}`}><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem value={NONE}>Keine Freigabe</SelectItem>
        <SelectItem value="viewer">Ansehen</SelectItem>
        <SelectItem value="data_editor">Daten aktualisieren</SelectItem>
        <SelectItem value="config_admin">Konfiguration ändern</SelectItem>
      </SelectContent>
    </Select>
  );
  return (
    <div className="space-y-4 rounded-xl border border-border/70 p-3">
      <div>
        <p className="text-sm font-medium">Wer darf die App öffnen?</p>
        <div className="mt-2 grid gap-2 sm:grid-cols-3">
          {([
            ["public", "Öffentlicher Link", "Jeder mit Link kann ansehen."],
            ["org", "Organisation", "Angemeldete Organisationsmitglieder sehen die App."],
            ["restricted", "Nur Freigegebene", "Nur Personen und Teams aus der Liste."],
          ] as const).map(([id, label, hint]) => (
            <Button key={id} type="button" variant={config.accessMode === id ? "secondary" : "outline"} className="h-auto justify-start whitespace-normal p-3 text-left" disabled={busy} onClick={() => void changeMode(id)}>
              <span><strong className="block text-xs">{label}</strong><span className="mt-1 block text-[11px] font-normal text-muted-foreground">{hint}</span></span>
            </Button>
          ))}
        </div>
      </div>
      <p className="text-xs text-muted-foreground">Öffentliche Links sind immer schreibgeschützt. Datenänderungen erfordern Anmeldung und eine passende Rolle.</p>
      {config.people.length > 0 && <div>
        <p className="module-eyebrow text-muted-foreground">Personen</p>
        <ul className="mt-2 divide-y divide-border/70">
          {config.people.map((person) => <li key={person.id} className="flex items-center justify-between gap-3 py-2">
            <span className="min-w-0"><span className="block truncate text-sm font-medium">{person.name}</span><span className="block truncate text-xs text-muted-foreground">{person.email}</span></span>
            {roleSelect("user", person.id, person.name)}
          </li>)}
        </ul>
      </div>}
      {config.teams.length > 0 && <div>
        <p className="module-eyebrow text-muted-foreground">Teams</p>
        <ul className="mt-2 divide-y divide-border/70">
          {config.teams.map((team) => <li key={team.id} className="flex items-center justify-between gap-3 py-2"><span className="truncate text-sm font-medium">{team.name}</span>{roleSelect("team", team.id, team.name)}</li>)}
        </ul>
      </div>}
    </div>
  );
}