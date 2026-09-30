import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { getAccount, listMyScopes, saveSettings } from "@/lib/account.functions";
import { DEFAULT_SETTINGS, type UserSettings } from "@/lib/settings";
import { useTheme } from "@/lib/theme";
import { useTranslation } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export const Route = createFileRoute("/_authenticated/konto/einstellungen")({
  component: SettingsPage,
});

function Row({
  title,
  hint,
  checked,
  onChange,
}: {
  title: string;
  hint: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-6 border-b py-3 last:border-0">
      <div>
        <p className="text-sm font-medium">{title}</p>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </div>
      <Switch checked={checked} onCheckedChange={onChange} aria-label={title} />
    </div>
  );
}

function SettingsPage() {
  const client = useQueryClient();
  const account = useQuery({ queryKey: ["account"], queryFn: () => getAccount() });
  const scopes = useQuery({ queryKey: ["my-scopes"], queryFn: () => listMyScopes() });
  const [value, setValue] = useState<UserSettings>(DEFAULT_SETTINGS);
  const { setTheme } = useTheme();
  const { setLanguage } = useTranslation();

  useEffect(() => {
    if (account.data) setValue(account.data.settings);
  }, [account.data]);

  const save = useMutation({
    mutationFn: () => saveSettings({ data: { settings: value } }),
    onSuccess: () => {
      toast.success("Einstellungen gespeichert");
      void client.invalidateQueries({ queryKey: ["account"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const patch = (next: Partial<UserSettings>) => setValue((current) => ({ ...current, ...next }));

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <section className="rounded-2xl border bg-card p-6 shadow-[var(--shadow-card)]">
        <h2 className="font-display text-xl font-semibold text-brand-navy">Darstellung</h2>
        <div className="mt-4">
          <Label htmlFor="theme">Erscheinungsbild</Label>
          <Select
            value={value.theme}
            onValueChange={(next) => {
              const mode = next as UserSettings["theme"];
              patch({ theme: mode });
              setTheme(mode);
            }}
          >
            <SelectTrigger id="theme" className="mt-1.5">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="system">Wie das Gerät</SelectItem>
              <SelectItem value="light">Hell</SelectItem>
              <SelectItem value="dark">Dunkel</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="mt-4">
          <Label htmlFor="language">Sprache</Label>
          <Select
            value={value.language}
            onValueChange={(next) => {
              const lang = next as UserSettings["language"];
              patch({ language: lang });
              setLanguage(lang);
            }}
          >
            <SelectTrigger id="language" className="mt-1.5">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="system">Wie der Browser</SelectItem>
              <SelectItem value="de">Deutsch</SelectItem>
              <SelectItem value="en">English</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="mt-4">
          <Row
            title="Raster anzeigen"
            hint="Neue Scopes starten mit sichtbarem Raster."
            checked={value.gridDefault}
            onChange={(next) => patch({ gridDefault: next })}
          />
          <Row
            title="Hilfslinien beim Verschieben"
            hint="Module rasten an Kanten und Mittelachsen ein."
            checked={value.guidesDefault}
            onChange={(next) => patch({ guidesDefault: next })}
          />
          <Row
            title="Beschriftungen an Verbindungen"
            hint="Werte und Namen erscheinen mittig auf der Linie."
            checked={value.edgeLabels}
            onChange={(next) => patch({ edgeLabels: next })}
          />
        </div>
      </section>

      <section className="rounded-2xl border bg-card p-6 shadow-[var(--shadow-card)]">
        <h2 className="font-display text-xl font-semibold text-brand-navy">Arbeiten</h2>
        <div className="mt-4">
          <Label htmlFor="start">Start-Scope</Label>
          <Select
            value={value.startBoardId ?? "none"}
            onValueChange={(next) => patch({ startBoardId: next === "none" ? null : next })}
          >
            <SelectTrigger id="start" className="mt-1.5">
              <SelectValue placeholder="Keiner" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Übersicht öffnen</SelectItem>
              {(scopes.data?.owned ?? []).map((scope) => (
                <SelectItem key={scope.id} value={scope.id}>
                  {scope.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="mt-4">
          <Row
            title="Automatisch speichern"
            hint="Änderungen werden ohne Zutun gesichert."
            checked={value.autoSave}
            onChange={(next) => patch({ autoSave: next })}
          />
        </div>

        <h2 className="mt-8 font-display text-xl font-semibold text-brand-navy">Benachrichtigungen</h2>
        <div className="mt-2">
          <Row
            title="Einladungen per E-Mail"
            hint="Hinweis, wenn dich jemand zu einem Scope einlädt."
            checked={value.notifyInvites}
            onChange={(next) => patch({ notifyInvites: next })}
          />
          <Row
            title="Fertige Agenten-Ergebnisse"
            hint="Hinweis, sobald eine Auswertung abgeschlossen ist."
            checked={value.notifyAgents}
            onChange={(next) => patch({ notifyAgents: next })}
          />
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          Der E-Mail-Versand wird im nächsten Schritt angebunden; deine Auswahl wird schon jetzt
          gespeichert.
        </p>
      </section>

      <div className="lg:col-span-2">
        <Button onClick={() => save.mutate()} disabled={save.isPending}>
          Einstellungen speichern
        </Button>
      </div>
    </div>
  );
}
