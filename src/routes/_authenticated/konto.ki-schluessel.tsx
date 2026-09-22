import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, Eye, EyeOff, KeyRound, ShieldCheck } from "lucide-react";
import {
  deleteAiKey,
  getAiUsage,
  listAiKeys,
  revokeAiKey,
  saveAiKey,
  setAiBudget,
  setAiRouting,
  setUseByok,
  testAiKey,
} from "@/lib/ai-keys.functions";
import { AI_PROVIDER_META, AI_PROVIDERS, type AiProvider } from "@/lib/ai-providers";
import { AI_FUNCTIONS, type AiFunctionId, type AiRouteProvider } from "@/lib/ai-functions";
import { formatCost } from "@/lib/ai-pricing";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export const Route = createFileRoute("/_authenticated/konto/ki-schluessel")({
  component: AiKeysPage,
});

const PROVIDER_KEY_URL: Record<AiProvider, string> = {
  openai: "https://platform.openai.com/api-keys",
  anthropic: "https://console.anthropic.com/settings/keys",
  google: "https://aistudio.google.com/app/apikey",
  openrouter: "https://openrouter.ai/keys",
};

type Pending =
  | { kind: "delete"; provider: AiProvider }
  | { kind: "revoke"; provider: AiProvider }
  | { kind: "replace"; provider: AiProvider; key: string };

function AiKeysPage() {
  const client = useQueryClient();
  const keys = useQuery({ queryKey: ["ai-keys"], queryFn: () => listAiKeys() });
  const usage = useQuery({ queryKey: ["ai-usage"], queryFn: () => getAiUsage() });
  const [visible, setVisible] = useState<Partial<Record<AiProvider, boolean>>>({});
  const [drafts, setDrafts] = useState<Partial<Record<AiProvider, string>>>({});
  const [budgetDraft, setBudgetDraft] = useState<Record<string, string>>({});
  const [modelDraft, setModelDraft] = useState<Partial<Record<AiFunctionId, string>>>({});
  const [testing, setTesting] = useState<AiProvider | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);

  const refresh = () => {
    void client.invalidateQueries({ queryKey: ["ai-keys"] });
    void client.invalidateQueries({ queryKey: ["ai-usage"] });
  };

  const save = useMutation({
    mutationFn: (input: { provider: AiProvider; key: string }) => saveAiKey({ data: input }),
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

  const revoke = useMutation({
    mutationFn: (provider: AiProvider) => revokeAiKey({ data: { provider, confirm: true } }),
    onSuccess: () => {
      toast.success("Zugang widerrufen – betroffene Funktionen laufen wieder über den Lovable-Zugang");
      refresh();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const toggle = useMutation({
    mutationFn: (input: { enabled: boolean; provider: AiProvider }) => setUseByok({ data: input }),
    onSuccess: () => refresh(),
    onError: (error: Error) => toast.error(error.message),
  });

  const routing = useMutation({
    mutationFn: (input: { fn: AiFunctionId; provider: AiRouteProvider; model?: string | null }) =>
      setAiRouting({ data: input }),
    onSuccess: () => {
      toast.success("Zuordnung gespeichert");
      refresh();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const budget = useMutation({
    mutationFn: (input: { provider: AiRouteProvider; amount: number }) =>
      setAiBudget({ data: input }),
    onSuccess: () => {
      toast.success("Ausgabenhinweis gespeichert");
      refresh();
    },
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
  const hasKey = (provider: AiRouteProvider) =>
    provider === "lovable" || Boolean(settings?.keys.some((entry) => entry.provider === provider));

  const confirmPending = () => {
    if (!pending) return;
    if (pending.kind === "delete") remove.mutate(pending.provider);
    if (pending.kind === "revoke") revoke.mutate(pending.provider);
    if (pending.kind === "replace") {
      save.mutate({ provider: pending.provider, key: pending.key });
      setDrafts((prev) => ({ ...prev, [pending.provider]: "" }));
    }
    setPending(null);
  };

  const pendingText = () => {
    if (!pending) return { title: "", body: "", action: "" };
    const label = AI_PROVIDER_META[pending.provider].label;
    if (pending.kind === "delete") {
      return {
        title: `Schlüssel von ${label} löschen?`,
        body: "Der verschlüsselte Schlüssel wird endgültig entfernt. Funktionen, die ihn nutzen, laufen danach über den mitgelieferten Lovable-Zugang. Der Vorgang wird im Protokoll festgehalten.",
        action: "Endgültig löschen",
      };
    }
    if (pending.kind === "revoke") {
      return {
        title: `Zugang zu ${label} widerrufen?`,
        body: "Der Schlüssel wird gelöscht, alle Funktionen dieses Anbieters werden auf den Lovable-Zugang zurückgesetzt und der BYOK-Schalter wird abgeschaltet, falls er auf diesen Anbieter zeigt. Der Widerruf wird protokolliert.",
        action: "Widerrufen",
      };
    }
    return {
      title: `Schlüssel von ${label} ersetzen?`,
      body: "Der bisherige Schlüssel wird überschrieben und lässt sich nicht wiederherstellen. Der Wechsel wird im Protokoll festgehalten.",
      action: "Ersetzen",
    };
  };

  const dialog = pendingText();

  return (
    <section className="space-y-6">
      <div className="rounded-2xl border bg-card p-6 shadow-[var(--shadow-card)]">
        <h2 className="font-display text-xl font-semibold text-brand-navy">KI-Schlüssel (BYOK)</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Bring your own key: Hinterlege eigene Schlüssel deiner KI-Anbieter und lege pro Funktion
          fest, welcher Anbieter und welches Modell arbeiten soll. Fehlt ein Schlüssel oder lehnt
          der Anbieter ab, springt automatisch der mitgelieferte Lovable-Zugang ein.
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
          Eigene Schlüssel verwenden
        </label>
        {settings?.useByok ? (
          <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
            <ShieldCheck className="h-3.5 w-3.5 text-emerald-700" aria-hidden="true" />
            Aktiv: Es gilt die Zuordnung je Funktion weiter unten.
          </p>
        ) : null}
      </div>

      {/* Zuordnung je Funktion */}
      <div className="rounded-2xl border bg-card p-6 shadow-[var(--shadow-card)]">
        <h3 className="font-display text-lg font-semibold text-brand-navy">Anbieter je Funktion</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Für jede KI-Funktion getrennt wählbar. Ohne eigenen Schlüssel wird immer der
          Lovable-Zugang verwendet.
        </p>
        <ul className="mt-4 space-y-3">
          {AI_FUNCTIONS.map((fn) => {
            const route = settings?.routing?.[fn.id] ?? { provider: "lovable", model: null };
            const draft = modelDraft[fn.id] ?? route.model ?? "";
            return (
              <li
                key={fn.id}
                className="grid gap-3 rounded-xl border p-4 sm:grid-cols-[1fr_180px_1fr_auto] sm:items-center"
              >
                <div>
                  <p className="text-sm font-medium">{fn.label}</p>
                  <p className="text-xs text-muted-foreground">{fn.hint}</p>
                </div>
                <Select
                  value={route.provider}
                  onValueChange={(value) =>
                    routing.mutate({
                      fn: fn.id,
                      provider: value as AiRouteProvider,
                      model: modelDraft[fn.id] ?? route.model,
                    })
                  }
                >
                  <SelectTrigger aria-label={`Anbieter für ${fn.label}`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="lovable">Lovable-KI-Zugang</SelectItem>
                    {AI_PROVIDERS.filter(
                      (provider) =>
                        fn.kind !== "transcription" ||
                        AI_PROVIDER_META[provider].supportsTranscription,
                    ).map((provider) => (
                      <SelectItem key={provider} value={provider} disabled={!hasKey(provider)}>
                        {AI_PROVIDER_META[provider].label}
                        {hasKey(provider) ? "" : " (kein Schlüssel)"}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input
                  value={draft}
                  disabled={route.provider === "lovable"}
                  placeholder={
                    route.provider === "lovable"
                      ? "Modell wird automatisch gewählt"
                      : AI_PROVIDER_META[route.provider as AiProvider].model
                  }
                  aria-label={`Modell für ${fn.label}`}
                  onChange={(event) =>
                    setModelDraft((prev) => ({ ...prev, [fn.id]: event.target.value }))
                  }
                />
                <Button
                  size="sm"
                  variant="outline"
                  disabled={route.provider === "lovable" || draft === (route.model ?? "")}
                  onClick={() =>
                    routing.mutate({ fn: fn.id, provider: route.provider, model: draft })
                  }
                >
                  Modell sichern
                </Button>
              </li>
            );
          })}
        </ul>
      </div>

      {/* Nutzung und Kosten */}
      <div className="rounded-2xl border bg-card p-6 shadow-[var(--shadow-card)]">
        <h3 className="font-display text-lg font-semibold text-brand-navy">
          Nutzung & geschätzte Kosten
        </h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Werte sind Schätzungen aus Umfang der Anfragen und üblichen Listenpreisen. Maßgeblich
          bleibt die Abrechnung deines Anbieters.
        </p>
        <ul className="mt-4 grid gap-3 sm:grid-cols-2">
          {(usage.data?.providers ?? []).map((entry) => {
            const key = entry.provider;
            const draft = budgetDraft[key] ?? (entry.budget ? String(entry.budget) : "");
            return (
              <li key={key} className="rounded-xl border p-4">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-medium">{entry.label}</p>
                  {entry.overBudget ? (
                    <Badge variant="destructive" className="gap-1">
                      <AlertTriangle className="h-3 w-3" aria-hidden="true" />
                      Hinweis überschritten
                    </Badge>
                  ) : null}
                </div>
                <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  <dt>Anfragen</dt>
                  <dd className="text-right text-foreground">{entry.requests}</dd>
                  <dt>davon fehlgeschlagen</dt>
                  <dd className="text-right text-foreground">{entry.failed}</dd>
                  <dt>Kosten laufender Monat</dt>
                  <dd className="text-right text-foreground">{formatCost(entry.costMonth)}</dd>
                  <dt>Kosten gesamt</dt>
                  <dd className="text-right text-foreground">{formatCost(entry.costTotal)}</dd>
                </dl>
                <div className="mt-3 flex items-center gap-2">
                  <Input
                    type="number"
                    min={0}
                    step="1"
                    className="h-8 w-28"
                    value={draft}
                    placeholder="z. B. 25"
                    aria-label={`Ausgabenhinweis für ${entry.label} in US-Dollar`}
                    onChange={(event) =>
                      setBudgetDraft((prev) => ({ ...prev, [key]: event.target.value }))
                    }
                  />
                  <span className="text-xs text-muted-foreground">$ / Monat</span>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      budget.mutate({ provider: key, amount: Number(draft || 0) })
                    }
                  >
                    Hinweis sichern
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      </div>

      {/* Schlüssel */}
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
                        info ? "Neuen Schlüssel eintragen, um zu ersetzen" : meta.keyPlaceholder
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
                      value={info?.baseUrl ?? AI_PROVIDER_META.openrouter.baseUrl}
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
                      if (info) {
                        setPending({ kind: "replace", provider, key: draft.trim() });
                        return;
                      }
                      save.mutate({ provider, key: draft.trim() });
                      setDrafts((prev) => ({ ...prev, [provider]: "" }));
                    }}
                  >
                    <KeyRound className="mr-1.5 h-4 w-4" aria-hidden="true" />
                    {info ? "Ersetzen" : "Speichern"}
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
                    <>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setPending({ kind: "revoke", provider })}
                      >
                        Widerrufen
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setPending({ kind: "delete", provider })}
                        className="text-destructive hover:text-destructive"
                      >
                        Löschen
                      </Button>
                    </>
                  ) : null}
                </div>
              </div>
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
            </li>
          );
        })}
      </ul>

      <AlertDialog open={pending !== null} onOpenChange={(open) => (open ? null : setPending(null))}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{dialog.title}</AlertDialogTitle>
            <AlertDialogDescription>{dialog.body}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Abbrechen</AlertDialogCancel>
            <AlertDialogAction onClick={confirmPending}>{dialog.action}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
