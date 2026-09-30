import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { getPrivacyMode, setPrivacyMode } from "@/lib/privacy.functions";
import { useTranslation } from "@/lib/i18n";

const OPTIONS = [
  { id: "strict", label: "Streng", hint: "E-Mail, IBAN, Telefon, Karten, IP, Steuernummern und Schlüssel werden vor KI-Aufrufen maskiert." },
  { id: "secrets", label: "Nur Schlüssel", hint: "Nur Zugangsschlüssel werden maskiert." },
  { id: "off", label: "Aus", hint: "Nichts wird maskiert. Wird protokolliert." },
] as const;

export function PrivacySection({ boardId, isOwner }: { boardId: string; isOwner: boolean }) {
  const { l } = useTranslation();
  const qc = useQueryClient();
  const get = useServerFn(getPrivacyMode);
  const set = useServerFn(setPrivacyMode);
  const q = useQuery({ queryKey: ["privacy", boardId], queryFn: () => get({ data: { boardId } }) });
  const m = useMutation({
    mutationFn: (mode: (typeof OPTIONS)[number]["id"]) => set({ data: { boardId, mode } }),
    onSuccess: (r) => {
      qc.setQueryData(["privacy", boardId], r);
      toast.success(l("Datenschutz-Filter gespeichert"));
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : l("Fehler")),
  });
  const current = q.data?.mode ?? "strict";
  return (
    <section className="space-y-2 border-t pt-4">
      <h3 className="text-sm font-semibold">{l("Datenschutz-Filter vor KI")}</h3>
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={l("Datenschutz-Filter")}>
        {OPTIONS.map((o) => (
          <button
            key={o.id}
            type="button"
            role="radio"
            aria-checked={current === o.id}
            disabled={!isOwner || m.isPending}
            onClick={() => {
              if (o.id === "off" && !window.confirm("Filter wirklich ausschalten? Persönliche Daten gehen dann ungefiltert an KI-Modelle.")) return;
              m.mutate(o.id);
            }}
            className={`rounded-full border px-3 py-1 text-xs transition ${
              current === o.id ? "border-primary bg-primary text-primary-foreground" : "bg-background hover:bg-muted"
            } disabled:opacity-60`}
          >
            {l(o.label)}
          </button>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        {OPTIONS.find((o) => o.id === current)?.hint} Namen und Adressen in Fließtext werden nicht zuverlässig erkannt.
        {!isOwner && " Nur der Inhaber kann das ändern."}
      </p>
    </section>
  );
}
