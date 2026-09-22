import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Copy, KeyRound } from "lucide-react";
import { listMyAppAccess, updateAppAccess } from "@/lib/account.functions";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export const Route = createFileRoute("/_authenticated/konto/apps")({
  component: AppAccessPage,
});

function AppAccessPage() {
  const client = useQueryClient();
  const apps = useQuery({ queryKey: ["app-access"], queryFn: () => listMyAppAccess() });

  const update = useMutation({
    mutationFn: (input: {
      appId: string;
      regenerate?: boolean;
      scope?: "read" | "write";
      isPublic?: boolean;
    }) => updateAppAccess({ data: { regenerate: false, ...input } }),
    onSuccess: () => {
      toast.success("Zugang aktualisiert");
      void client.invalidateQueries({ queryKey: ["app-access"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const copy = async (text: string, label: string) => {
    await navigator.clipboard.writeText(text);
    toast.success(`${label} kopiert`);
  };

  return (
    <section className="rounded-2xl border bg-card p-6 shadow-[var(--shadow-card)]">
      <h2 className="font-display text-xl font-semibold text-brand-navy">App-Zugänge</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Jede App hat einen eigenen Schlüssel. Wer ihn besitzt, erreicht die App ohne Anmeldung –
        gib ihn nur an vertraute Stellen weiter und erneuere ihn bei Verdacht sofort.
      </p>

      <ul className="mt-6 space-y-3">
        {(apps.data ?? []).map((app) => {
          const origin = typeof window === "undefined" ? "" : window.location.origin;
          return (
            <li key={app.id} className="rounded-xl border p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="font-medium">{app.title || "Unbenannte App"}</p>
                  <p className="text-xs text-muted-foreground">
                    Geändert am {new Date(app.updated_at).toLocaleDateString("de-DE")}
                  </p>
                </div>
                <Badge variant={app.is_public ? "default" : "secondary"}>
                  {app.is_public ? "Aktiv" : "Abgeschaltet"}
                </Badge>
              </div>

              <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto_auto] sm:items-center">
                <code className="truncate rounded-lg bg-muted px-3 py-2 font-mono text-xs">
                  {app.mcp_token || "kein Schlüssel"}
                </code>
                <Select
                  value={app.mcp_scope === "write" ? "write" : "read"}
                  onValueChange={(next) =>
                    update.mutate({ appId: app.id, scope: next as "read" | "write" })
                  }
                >
                  <SelectTrigger className="w-48" aria-label={`Rechte von ${app.title}`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="read">Nur Lesen</SelectItem>
                    <SelectItem value="write">Lesen und Schreiben</SelectItem>
                  </SelectContent>
                </Select>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void copy(app.mcp_token ?? "", "Schlüssel")}
                  >
                    <Copy className="mr-1.5 h-4 w-4" aria-hidden="true" />
                    Schlüssel
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void copy(`${origin}/app/${app.id}`, "Adresse")}
                  >
                    Adresse
                  </Button>
                </div>
              </div>

              <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                <label className="flex items-center gap-2 text-sm">
                  <Switch
                    checked={app.is_public}
                    onCheckedChange={(next) => update.mutate({ appId: app.id, isPublic: next })}
                    aria-label={`Zugang für ${app.title}`}
                  />
                  Zugang aktiv
                </label>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => update.mutate({ appId: app.id, regenerate: true })}
                >
                  <KeyRound className="mr-1.5 h-4 w-4" aria-hidden="true" />
                  Schlüssel neu erzeugen
                </Button>
              </div>
            </li>
          );
        })}
        {apps.data && apps.data.length === 0 ? (
          <li className="rounded-xl border px-4 py-6 text-sm text-muted-foreground">
            Du hast noch keine App veröffentlicht.
          </li>
        ) : null}
      </ul>
    </section>
  );
}
