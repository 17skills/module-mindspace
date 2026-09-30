import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, CheckCircle2, Cpu } from "lucide-react";
import { Input } from "@/components/ui/input";
import { checkModelCapabilities } from "@/lib/model-registry.functions";
import {
  CAPABILITY_LABEL,
  ENGINE_PROVIDERS,
  ENGINE_PROVIDER_META,
  MODEL_SUGGESTIONS,
  checkEngineCompatibility,
  compatibilityMessage,
  engineBindingToMetadata,
  readEngineBinding,
  type EngineCapability,
  type EngineProvider,
} from "@/lib/module-engine";
import { useTranslation } from "@/lib/i18n";

/**
 * Rechenkern eines Moduls: Anbieterart, Modell und eigenes Token-Budget.
 * Adressen, Ports und Schlüssel bleiben serverseitig – hier steht nur,
 * WAS gebraucht wird, damit der Scope überall lauffähig bleibt.
 * `required` nennt die Fähigkeiten, die das Modul vom Modell braucht.
 */
export function EngineSection({
  metadata,
  onChange,
  required = ["structured"],
}: {
  metadata: Record<string, unknown> | null | undefined;
  onChange: (patch: Record<string, unknown>) => void;
  required?: EngineCapability[];
}) {
  const { l } = useTranslation();
  const binding = readEngineBinding(metadata);
  const [model, setModel] = useState(binding.model ?? "");
  const [budget, setBudget] = useState(binding.maxTokens ? String(binding.maxTokens) : "");

  useEffect(() => {
    const current = readEngineBinding(metadata);
    setModel(current.model ?? "");
    setBudget(current.maxTokens ? String(current.maxTokens) : "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify((metadata ?? {})["engine"] ?? null)]);

  function save(next: {
    provider?: EngineProvider;
    model?: string | null;
    maxTokens?: number | null;
  }) {
    const merged = {
      provider: next.provider ?? binding.provider,
      model: next.model === undefined ? binding.model : next.model,
      maxTokens: next.maxTokens === undefined ? binding.maxTokens : next.maxTokens,
    };
    onChange({ engine: engineBindingToMetadata(merged) });
  }

  const meta = ENGINE_PROVIDER_META[binding.provider];
  const suggestions = MODEL_SUGGESTIONS[binding.provider];
  const lookup = useServerFn(checkModelCapabilities);
  const live = useQuery({
    queryKey: ["model-capabilities", binding.provider, binding.model, required.join(",")],
    queryFn: () =>
      lookup({ data: { provider: binding.provider, model: binding.model!, required } }),
    enabled: binding.provider !== "default" && !!binding.model,
    staleTime: 60 * 60 * 1000,
    retry: false,
  });
  const report = checkEngineCompatibility(
    binding,
    required,
    live.data?.entry ?? null,
    live.data?.candidates,
  );
  const showReport =
    binding.provider !== "default" &&
    binding.model &&
    (!report.ok || report.uncertain.length > 0 || report.notFound);

  return (
    <div className="space-y-2.5 rounded-lg border border-border/70 p-3">
      <div className="flex items-center gap-1.5">
        <Cpu className="size-3.5 text-muted-foreground" aria-hidden />
        <p className="text-xs font-medium">{l("Rechenkern & Modell")}</p>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {ENGINE_PROVIDERS.map((option) => (
          <button
            key={option}
            type="button"
            aria-pressed={binding.provider === option}
            onClick={() => save({ provider: option, model: null })}
            className={`rounded-full border px-2.5 py-1 text-xs transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
              binding.provider === option
                ? "border-primary bg-accent/50"
                : "text-muted-foreground hover:bg-secondary"
            }`}
          >
            {ENGINE_PROVIDER_META[option].label}
          </button>
        ))}
      </div>

      <p className="text-xs leading-snug text-muted-foreground">{meta.hint}</p>

      {binding.provider !== "default" && (
        <>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground" htmlFor="engine-model">
               {l("Modell")}
            </label>
            <Input
              id="engine-model"
              value={model}
              onChange={(event) => setModel(event.target.value)}
              onBlur={() => save({ model: model.trim() || null })}
              placeholder={suggestions[0] ?? "Modellkennung"}
              className="h-8 text-xs"
            />
            {suggestions.length > 0 && (
              <div className="mt-1.5 flex flex-wrap gap-1">
                {suggestions.map((item) => (
                  <button
                    key={item}
                    type="button"
                    onClick={() => {
                      setModel(item);
                      save({ model: item });
                    }}
                    className="rounded-full border border-border/70 px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-secondary"
                  >
                    {item}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground" htmlFor="engine-budget">
               {l("Eigenes Token-Budget (optional)")}
            </label>
            <Input
              id="engine-budget"
              inputMode="numeric"
              value={budget}
              onChange={(event) => setBudget(event.target.value.replace(/[^\d]/g, ""))}
              onBlur={() => {
                const value = Number(budget);
                save({ maxTokens: Number.isFinite(value) && value > 0 ? value : null });
              }}
              placeholder="z. B. 16000"
              className="h-8 text-xs"
            />
          </div>

          {showReport && (
            <div
              role={report.ok ? "status" : "alert"}
              className={`flex gap-1.5 rounded-md border p-2 text-[11px] leading-snug ${
                report.ok ? "border-border/70 text-muted-foreground" : "border-destructive/50 text-destructive"
              }`}
            >
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              <div className="space-y-1.5">
                <p>
                  {report.ok && !report.notFound
                    ? `Nicht sicher bekannt, ob ${binding.model} Folgendes kann: ${report.uncertain.map((c) => CAPABILITY_LABEL[c]).join(", ")}.`
                    : compatibilityMessage(binding, report)}
                </p>
                <p className="text-muted-foreground">
                   {l(report.source === "provider" ? "Laut Anbieter geprüft." : "Geschätzt nach Modellname.")}
                </p>
                <div className="flex flex-wrap gap-1">
                  {report.alternatives.slice(0, 3).map((item) => (
                    <button
                      key={item}
                      type="button"
                      onClick={() => {
                        setModel(item);
                        save({ model: item });
                      }}
                      className="rounded-full border border-border/70 bg-background px-2 py-0.5 text-foreground hover:bg-secondary"
                    >
                      {item}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => save({ provider: "default", model: null })}
                    className="rounded-full border border-border/70 bg-background px-2 py-0.5 text-foreground hover:bg-secondary"
                  >
                     {l("Standard")}
                  </button>
                </div>
              </div>
            </div>
          )}
          {!showReport && binding.model && report.source === "provider" && (
            <p role="status" className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
               <CheckCircle2 className="size-3.5" aria-hidden /> {l("Laut Anbieter passend.")}
            </p>
          )}

          {meta.needsKey && (
            <p className="text-[11px] leading-snug text-muted-foreground">
               {l("Der Schlüssel liegt im Konto bzw. auf dem Server – nie im Bauplan. Fehlt er, läuft das Modul über den Standard-Rechenkern.")}
            </p>
          )}
          {binding.provider === "local" && (
            <p className="text-[11px] leading-snug text-muted-foreground">
               {l("Adresse und Port des lokalen Servers stellt die Umgebung ein. Ist dort kein Server hinterlegt, läuft das Modul über den Standard-Rechenkern.")}
            </p>
          )}
        </>
      )}
    </div>
  );
}
