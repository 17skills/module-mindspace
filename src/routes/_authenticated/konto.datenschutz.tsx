import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Download, ShieldAlert } from "lucide-react";
import {
  cancelDeletion,
  deleteAccountNow,
  exportMyData,
  getAccount,
  listMyAuditLog,
  requestDeletion,
  setConsent,
} from "@/lib/account.functions";
import { CONSENT_PURPOSES, PROCESSING_PURPOSES } from "@/lib/settings";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

export const Route = createFileRoute("/_authenticated/konto/datenschutz")({
  component: PrivacyPage,
});

const ACTION_LABEL: Record<string, string> = {
  "profile.update": "Profil geändert",
  "consent.granted": "Einwilligung erteilt",
  "consent.revoked": "Einwilligung widerrufen",
  "data.export": "Daten exportiert",
  "account.deletion_requested": "Löschung vorgemerkt",
  "account.deletion_cancelled": "Löschung widerrufen",
  "app.token_rotated": "App-Schlüssel erneuert",
  "app.access_updated": "App-Zugang geändert",
  "role.admin_granted": "Administratorrolle vergeben",
  "role.admin_revoked": "Administratorrolle entzogen",
  "account.blocked": "Konto gesperrt",
  "account.unblocked": "Konto entsperrt",
};

function PrivacyPage() {
  const client = useQueryClient();
  const account = useQuery({ queryKey: ["account"], queryFn: () => getAccount() });
  const log = useQuery({ queryKey: ["my-audit"], queryFn: () => listMyAuditLog() });
  const [confirm, setConfirm] = useState("");

  const consent = useMutation({
    mutationFn: (input: { purpose: string; granted: boolean }) => setConsent({ data: input }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["account"] });
      void client.invalidateQueries({ queryKey: ["my-audit"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const exportData = useMutation({
    mutationFn: () => exportMyData(),
    onSuccess: (data) => {
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `scopebuilder-daten-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      URL.revokeObjectURL(url);
      toast.success("Datei heruntergeladen");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const request = useMutation({
    mutationFn: () => requestDeletion(),
    onSuccess: () => {
      toast.success("Löschung vorgemerkt – 7 Tage Widerrufsfrist");
      void client.invalidateQueries({ queryKey: ["account"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const cancel = useMutation({
    mutationFn: () => cancelDeletion(),
    onSuccess: () => {
      toast.success("Löschung widerrufen");
      void client.invalidateQueries({ queryKey: ["account"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const erase = useMutation({
    mutationFn: () => deleteAccountNow({ data: { confirm: "LÖSCHEN" } }),
    onSuccess: async () => {
      await supabase.auth.signOut();
      window.location.href = "/auth";
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const deletionDue = account.data?.deletionRequestedAt
    ? new Date(new Date(account.data.deletionRequestedAt).getTime() + 7 * 86_400_000)
    : null;

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border bg-card p-6 shadow-[var(--shadow-card)]">
        <h2 className="font-display text-xl font-semibold text-brand-navy">Einwilligungen</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Getrennt erteilbar und jederzeit widerrufbar. Die Anwendung selbst funktioniert auch
          ohne Zustimmung.
        </p>
        <div className="mt-4">
          {CONSENT_PURPOSES.map((item) => {
            const state = account.data?.consents?.[item.key];
            return (
              <div key={item.key} className="flex items-start justify-between gap-6 border-b py-3 last:border-0">
                <div>
                  <p className="text-sm font-medium">{item.title}</p>
                  <p className="text-xs text-muted-foreground">{item.text}</p>
                  {state?.at ? (
                    <p className="mt-1 text-xs text-muted-foreground">
                      Zuletzt geändert am {new Date(state.at).toLocaleDateString("de-DE")}
                    </p>
                  ) : null}
                </div>
                <Switch
                  checked={Boolean(state?.granted)}
                  aria-label={item.title}
                  onCheckedChange={(next) => consent.mutate({ purpose: item.key, granted: next })}
                />
              </div>
            );
          })}
        </div>
      </section>

      <section className="rounded-2xl border bg-card p-6 shadow-[var(--shadow-card)]">
        <h2 className="font-display text-xl font-semibold text-brand-navy">
          Wofür deine Daten verarbeitet werden
        </h2>
        <ul className="mt-4 space-y-3">
          {PROCESSING_PURPOSES.map((item) => (
            <li key={item.service} className="rounded-xl border p-4">
              <p className="text-sm font-medium">{item.service}</p>
              <p className="mt-1 text-xs text-muted-foreground">Daten: {item.data}</p>
              <p className="text-xs text-muted-foreground">Zweck: {item.purpose}</p>
            </li>
          ))}
        </ul>
        <p className="mt-4 text-xs text-muted-foreground">
          Ausführlich in der{" "}
          <Link to="/datenschutz" className="underline underline-offset-4">
            Datenschutzerklärung
          </Link>
          .
        </p>
      </section>

      <section className="rounded-2xl border bg-card p-6 shadow-[var(--shadow-card)]">
        <h2 className="font-display text-xl font-semibold text-brand-navy">Deine Daten mitnehmen</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Profil, Scopes, Module, Verbindungen, Mitgliedschaften, Apps und Einstellungen als
          Datei.
        </p>
        <Button className="mt-4" onClick={() => exportData.mutate()} disabled={exportData.isPending}>
          <Download className="mr-1.5 h-4 w-4" aria-hidden="true" />
          Daten herunterladen
        </Button>
      </section>

      <section className="rounded-2xl border bg-card p-6 shadow-[var(--shadow-card)]">
        <h2 className="font-display text-xl font-semibold text-brand-navy">Protokoll</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Sicherheitsrelevante Vorgänge deines Kontos. Ohne IP-Adresse und ohne Standort,
          Aufbewahrung 90 Tage.
        </p>
        <ul className="mt-4 divide-y rounded-xl border">
          {(log.data ?? []).map((entry) => (
            <li key={entry.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
              <span>{ACTION_LABEL[entry.action] ?? entry.action}</span>
              <span className="text-xs text-muted-foreground">
                {new Date(entry.created_at).toLocaleString("de-DE")}
              </span>
            </li>
          ))}
          {log.data && log.data.length === 0 ? (
            <li className="px-4 py-6 text-sm text-muted-foreground">Noch keine Einträge.</li>
          ) : null}
        </ul>
      </section>

      <section className="rounded-2xl border bg-card p-6 shadow-[var(--shadow-card)]">
        <h2 className="font-display text-xl font-semibold text-brand-navy">Konto löschen</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Gelöscht werden: Profil, eigene Scopes samt Modulen und Verbindungen, Apps,
          Mitgliedschaften, Bibliothekseinträge, Einwilligungen und Protokoll. Das lässt sich
          danach nicht rückgängig machen.
        </p>

        {deletionDue ? (
          <Alert className="mt-4">
            <ShieldAlert className="h-4 w-4" aria-hidden="true" />
            <AlertTitle>Löschung vorgemerkt</AlertTitle>
            <AlertDescription>
              Dein Konto wird am {deletionDue.toLocaleDateString("de-DE")} endgültig entfernt. Bis
              dahin kannst du widerrufen.
            </AlertDescription>
          </Alert>
        ) : null}

        <div className="mt-4 flex flex-wrap gap-2">
          {deletionDue ? (
            <Button variant="outline" onClick={() => cancel.mutate()}>
              Löschung widerrufen
            </Button>
          ) : (
            <Button variant="outline" onClick={() => request.mutate()}>
              In 7 Tagen löschen
            </Button>
          )}
        </div>

        <div className="mt-6 max-w-sm">
          <Label htmlFor="confirm">Sofort löschen: tippe LÖSCHEN</Label>
          <Input
            id="confirm"
            value={confirm}
            onChange={(event) => setConfirm(event.target.value)}
            placeholder="LÖSCHEN"
          />
          <Button
            variant="destructive"
            className="mt-3"
            disabled={confirm !== "LÖSCHEN" || erase.isPending}
            onClick={() => erase.mutate()}
          >
            Konto endgültig löschen
          </Button>
        </div>
      </section>
    </div>
  );
}
