import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Eye, EyeOff, KeyRound, ShieldCheck } from "lucide-react";
import {
  deleteAiKey,
  listAiKeys,
  saveAiKey,
  setUseByok,
  testAiKey,
} from "@/lib/ai-keys.functions";
import { AI_PROVIDER_META, AI_PROVIDERS, type AiProvider } from "@/lib/ai-providers";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";

export const Route = createFileRoute("/_authenticated/konto/ki-schluessel")({
  component: AiKeysPage,
});

const PROVIDER_KEY_URL: Record<AiProvider, string> = {
  openai: "https://platform.openai.com/api-keys",
  anthropic: "https://console.anthropic.com/settings/keys",
  google: "https://aistudio.google.com/app/apikey",
  openrouter: "https://openrouter.ai/keys",
};

function maskKey(value: string) {
  if (value.length <= 8) return "••••";
  return `${value.slice(0, 3)} •••• ${value.slice(-4)}`;
}

function AiKeysPage() {
  const client = useQueryClient();
  const keys = useQuery({ queryKey: ["ai-keys"], queryFn: () => listAiKeys() });
  const [visible, setVisible] = useState<Partial<Record<AiProvider, boolean>>>({});
  const [drafts, setDrafts] = useState<Partial<Record<AiProvider, string>>>({});
  const [testing, setTesting] = useState<AiProvider | null>(null);

  const refresh = () => void client.invalidateQueries({ queryKey: ["ai-keys"] });

  const save = useMutation({
    mutationFn: (input: { provider: AiProvider; key: string; baseUrl?: string; modelHint?: string }) =>
      saveAiKey({ data: input }),
    onSuccess: () => {
      toast.success("Schlüssel gespeichert – verschlüsselt hinterlegt");
      refresh();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const remove = useMutation({
    mutationFn: (provider: AiProvider) => deleteAiKey({ data: { provider } }),
    onSuccess: () => {
      toast.success("Schlüssel gelöscht");
      refresh();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const toggle = useMutation({
    mutationFn: (input: { enabled: boolean; provider: AiProvider }) =>
      setUseByok({ data: input }),
    onSuccess: () => refresh(),
    onError: (error: Error) => toast.error(error.message),
  });

  const test = useMutation({
    mutationFn: (provider: AiProvider) => testAiKey({ data: { provider } }),
    onSuccess: (result) => {
      setTesting(null);
      if (result.ok) toast.success(result.message);
      else toast.error(result.message);
    },
    onError: (error: Error) => {
      setTesting(null);
      toast.error(error.message);
    },
  });

  const settings = keys.data;

  return (
    <section className="space-y-6">
      <div className="rounded-2xl border bg-card p-6 shadow-[var(--shadow-card)]">
        <h2 className="font-display text-xl font-semibold text-brand-navy">KI-Schlüssel (BYOK)</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Bring your own key: Hinterlege eigene Schlüssel deiner KI-Anbieter. Alle Agenten,
          Feld-Analysen, Transkriptionen und Foto-Bewertungen laufen dann über deinen Schlüssel und
          dein Konto beim Anbieter – mit deinem Datenschutz. Ohne eigenen Schlüssel läuft alles über
          den mitgelieferten Zugang.
        </p>
        <label className="mt-4 flex items-center gap-2 text-sm">
          <Switch
            checked={settings?.useByok ?? false}
            disabled={!settings?.keys.length}
            onCheckedChange={(next) =>
              toggle.mutate({ enabled: next, provider: settings?.byokProvider ?? "openai" })
            }
            aria-label="Eigenen KI-Schlüssel verwenden"
          />
          Eigenen Schlüssel verwenden
        </label>
        {settings?.useByok ? (
          <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
            <ShieldCheck className="h-3.5 w-3.5 text-emerald-700" aria-hidden="true" />
            Aktiv: Anfragen laufen über {AI_PROVIDER_META[settings.byokProvider ?? "openai"].label}.
            Fehlt der Schlüssel oder ist er ungültig, springt automatisch der mitgelieferte Zugang ein.
          </p>
        ) : null}
      </div>

      <ul className="space-y-3">
        {AI_PROVIDERS.map((provider) => {
          const meta = AI_PROVIDER_META[provider];
          const info = settings?.keys.find((entry) => entry.provider === provider);
          const draft = drafts[provider] ?? "";
          return (
            <li key={provider} className="rounded-xl border bg-card p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="font-medium">{meta.label}</p>
                  <p className="text-xs text-muted-foreground">
                    {info ? (
                      <>
                        Hinterlegt: •••• {info.last4}
                        {info.updatedAt
                          ? ` · geändert am ${new Date(info.updatedAt).toLocaleDateString("de-DE")}`
                          : ""}
                      </>
                    ) : (
                      "Noch kein eigener Schlüssel"
                    )}
                  </p>
                </div>
                <Badge variant={info ? "default" : "secondary"}>
                  {info ? "Hinterlegt" : "Lovable-Zugang"}
                </Badge>
              </div>

              <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto]">
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Input
                      type={visible[provider] ? "text" : "password"}
                      value={draft}
                      onChange={(event) =>
                        setDrafts((prev) => ({ ...prev, [provider]: event.target.value }))
                      }
                      placeholder={
                        info ? "Neuen Schlüssel eintragen, um zu ersetzen" : AI_PROVIDER_META[provider].keyPlaceholder
                      }
                      aria-label={`${meta.label} API-Schlüssel`}
                      autoComplete="off"
                    />
                    <button
                      type="button"
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      onClick={() =>
                        setVisible((prev) => ({ ...prev, [provider]: !prev[provider] }))
                      }
                      aria-label={visible[provider] ? "Schlüssel verbergen" : "Schlüssel zeigen"}
                    >
                      {visible[provider] ? (
                        <EyeOff className="h-4 w-4" aria-hidden="true" />
                      ) : (
                        <Eye className="h-4 w-4" aria-hidden="true" />
                      )}
                    </button>
                  </div>
                  {provider === "openrouter" ? (
                    <Input
                      className="w-56"
                      value={info?.baseUrl ?? ""}
                      disabled
                      placeholder="Basis-Adresse"
                      aria-label="Basis-Adresse"
                    />
                  ) : null}
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    disabled={draft.trim().length < 8 || save.isPending}
                    onClick={() => {
                      save.mutate({ provider, key: draft.trim() });
                      setDrafts((prev) => ({ ...prev, [provider]: "" }));
                    }}
                  >
                    <KeyRound className="mr-1.5 h-4 w-4" aria-hidden="true" />
                    Speichern
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!info || testing === provider}
                    onClick={() => {
                      setTesting(provider);
                      test.mutate(provider);
                    }}
                  >
                    {testing === provider ? "Prüfe…" : "Verbindung testen"}
                  </Button>
                  {info ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => remove.mutate(provider)}
                      className="text-destructive hover:text-destructive"
                    >
                      Entfernen
                    </Button>
                  ) : null}
                </div>
              </div>
              {PROVIDER_KEY_URL[provider] ? (
                <p className="mt-2 text-xs text-muted-foreground">
                  Schlüssel erhältst du bei{" "}
                  <a
                    href={PROVIDER_KEY_URL[provider]}
                    target="_blank"
                    rel="noreferrer"
                    className="underline underline-offset-2"
                  >
                    {new URL(PROVIDER_KEY_URL[provider]).host}
                  </a>
                  . Er wird verschlüsselt gespeichert und nie im Klartext angezeigt.
                </p>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
