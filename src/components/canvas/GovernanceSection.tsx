import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { FileDown } from "lucide-react";
import { getMyRoles } from "@/lib/account.functions";
import { getGovernance, getGovernanceEvidence, setGovernance } from "@/lib/governance.functions";
import {
  DEFAULT_GOVERNANCE,
  LIFECYCLES,
  LIFECYCLE_LABEL,
  RISK_HINT,
  RISK_LABEL,
  RISK_TIERS,
  type Governance,
} from "@/lib/governance";

/** Risikostufe, Zweck und Verantwortung – optional, aber prüfbar (ISO 42001 / EU AI Act). */
export function GovernanceSection({ boardId, isOwner }: { boardId: string; isOwner: boolean }) {
  const qc = useQueryClient();
  const get = useServerFn(getGovernance);
  const save = useServerFn(setGovernance);
  const evidence = useServerFn(getGovernanceEvidence);
  const q = useQuery({ queryKey: ["governance", boardId], queryFn: () => get({ data: { boardId } }) });
  const [form, setForm] = useState<Governance>(DEFAULT_GOVERNANCE);
  const [open, setOpen] = useState(false);
  const rolesFn = useServerFn(getMyRoles);
  const roles = useQuery({ queryKey: ["my-roles"], queryFn: () => rolesFn() });
  const mayReport = Boolean(roles.data?.isDeveloper);

  useEffect(() => {
    if (q.data) setForm(q.data);
  }, [q.data]);

  const m = useMutation({
    mutationFn: (next: Governance) => save({ data: { boardId, governance: next } }),
    onSuccess: (r) => {
      qc.setQueryData(["governance", boardId], r);
      toast.success("Einstufung gespeichert");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Fehler"),
  });

  function update(patch: Partial<Governance>) {
    const next = { ...form, ...patch };
    setForm(next);
    if (isOwner) m.mutate(next);
  }

  return (
    <section className="space-y-3 border-t pt-4">
      <div>
        <h3 className="text-sm font-semibold">KI-Governance &amp; Risikostufe</h3>
        <p className="text-xs text-muted-foreground">
          Für Prototypen genügt „Minimal“. Die Angaben reisen im Bauplan mit und dienen als Nachweis.
        </p>
      </div>

      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Risikostufe">
        {RISK_TIERS.map((tier) => (
          <button
            key={tier}
            type="button"
            role="radio"
            aria-checked={form.riskTier === tier}
            disabled={!isOwner || m.isPending}
            onClick={() => update({ riskTier: tier })}
            className={`rounded-full border px-3 py-1 text-xs transition ${
              form.riskTier === tier
                ? "border-primary bg-primary text-primary-foreground"
                : "bg-background hover:bg-muted"
            } disabled:opacity-60`}
          >
            {RISK_LABEL[tier]}
          </button>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">{RISK_HINT[form.riskTier]}</p>

      <button
        type="button"
        className="text-xs underline underline-offset-2 text-muted-foreground"
        onClick={() => setOpen((v) => !v)}
      >
        {open ? "Details ausblenden" : "Zweck und Verantwortung angeben"}
      </button>

      {open ? (
        <div className="space-y-3">
          <div>
            <Label htmlFor="gov-purpose" className="text-xs">
              Zweck (wofür wird dieser Scope genutzt?)
            </Label>
            <Input
              id="gov-purpose"
              value={form.intendedUse}
              disabled={!isOwner}
              placeholder="z. B. Zustandsbewertung von Anlagen nach ISO 55001"
              onChange={(e) => setForm({ ...form, intendedUse: e.target.value })}
              onBlur={() => isOwner && m.mutate(form)}
              className="mt-1 rounded-xl text-xs"
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="gov-owner" className="text-xs">
                Fachlich verantwortlich
              </Label>
              <Input
                id="gov-owner"
                value={form.owner}
                disabled={!isOwner}
                placeholder="Name oder Rolle"
                onChange={(e) => setForm({ ...form, owner: e.target.value })}
                onBlur={() => isOwner && m.mutate(form)}
                className="mt-1 rounded-xl text-xs"
              />
            </div>
            <div>
              <Label htmlFor="gov-contact" className="text-xs">
                Kontakt
              </Label>
              <Input
                id="gov-contact"
                value={form.contact}
                disabled={!isOwner}
                placeholder="E-Mail oder Abteilung"
                onChange={(e) => setForm({ ...form, contact: e.target.value })}
                onBlur={() => isOwner && m.mutate(form)}
                className="mt-1 rounded-xl text-xs"
              />
            </div>
          </div>
          <div>
            <Label htmlFor="gov-lifecycle" className="text-xs">
              Status
            </Label>
            <select
              id="gov-lifecycle"
              value={form.lifecycle}
              disabled={!isOwner}
              onChange={(e) => update({ lifecycle: e.target.value as Governance["lifecycle"] })}
              className="mt-1 h-9 w-full rounded-xl border border-border bg-background px-2 text-sm"
            >
              {LIFECYCLES.map((l) => (
                <option key={l} value={l}>
                  {LIFECYCLE_LABEL[l]}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium">Menschliche Freigabe</p>
              <p className="text-xs text-muted-foreground">
                Ergebnisse wirken erst, wenn ein Mensch sie bestätigt.
              </p>
            </div>
            <Switch
              checked={form.humanOversight}
              disabled={!isOwner}
              onCheckedChange={(v) => update({ humanOversight: v })}
            />
          </div>
          {isOwner ? (
            <Button size="sm" variant="outline" disabled={m.isPending} onClick={() => m.mutate(form)}>
              Speichern
            </Button>
          ) : null}
        </div>
      ) : null}

      {!isOwner ? (
        <p className="text-xs text-muted-foreground">Nur der Inhaber kann die Einstufung ändern.</p>
      ) : null}
      {mayReport ? (
      <Button
        size="sm"
        variant="outline"
        className="gap-1.5"
        onClick={async () => {
          try {
            const data = await evidence({ data: { boardId } });
            const { downloadGovernancePdf } = await import("@/lib/governance-pdf");
            await downloadGovernancePdf(data);
          } catch (e) {
            toast.error(e instanceof Error ? e.message : "PDF konnte nicht erstellt werden");
          }
        }}
      >
        <FileDown className="size-4" /> Nachweis als PDF
      </Button>
      ) : null}
    </section>
  );
}
