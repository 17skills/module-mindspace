import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, FileDown, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { getMyRoles } from "@/lib/account.functions";
import { getGovernanceEvidence, listGovernance } from "@/lib/governance.functions";
import {
  LIFECYCLES,
  LIFECYCLE_LABEL,
  RISK_LABEL,
  RISK_TIERS,
  openReviews,
  type Lifecycle,
  type RiskTier,
} from "@/lib/governance";

export const Route = createFileRoute("/_authenticated/konto/governance")({
  head: () => ({
    meta: [
      { title: "KI-Governance Übersicht — scopebuilder" },
      { name: "description", content: "Alle Scopes nach Risikostufe und Freigabestatus, offene Prüfungen und PDF-Nachweise." },
      { property: "og:title", content: "KI-Governance Übersicht — scopebuilder" },
      { property: "og:description", content: "Risikostufen, Freigabestatus und offene Prüfungen aller Scopes." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: GovernancePage,
});

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`rounded-full border px-3 py-1 text-xs transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
        active ? "border-primary bg-primary text-primary-foreground" : "bg-background hover:bg-muted"
      }`}
    >
      {children}
    </button>
  );
}

function GovernancePage() {
  const list = useServerFn(listGovernance);
  const evidence = useServerFn(getGovernanceEvidence);
  const rolesFn = useServerFn(getMyRoles);
  const roles = useQuery({ queryKey: ["my-roles"], queryFn: () => rolesFn() });
  const allowed = Boolean(roles.data?.isDeveloper);
  const q = useQuery({ queryKey: ["governance-list"], queryFn: () => list(), enabled: allowed });
  const [risk, setRisk] = useState<RiskTier | "all">("all");
  const [status, setStatus] = useState<Lifecycle | "all">("all");
  const [onlyOpen, setOnlyOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const rows = useMemo(
    () =>
      (q.data ?? [])
        .map((r) => ({ ...r, open: openReviews(r.governance) }))
        .filter((r) => risk === "all" || r.governance.riskTier === risk)
        .filter((r) => status === "all" || r.governance.lifecycle === status)
        .filter((r) => !onlyOpen || r.open.length > 0)
        .sort((a, b) => b.open.length - a.open.length),
    [q.data, risk, status, onlyOpen],
  );
  const openTotal = (q.data ?? []).filter((r) => openReviews(r.governance).length > 0).length;

  async function pdf(boardId: string) {
    setBusy(boardId);
    try {
      const data = await evidence({ data: { boardId } });
      const { downloadGovernancePdf } = await import("@/lib/governance-pdf");
      await downloadGovernancePdf(data);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "PDF konnte nicht erstellt werden");
    } finally {
      setBusy(null);
    }
  }

  if (roles.isLoading) return <p className="text-sm text-muted-foreground">Wird geladen …</p>;
  if (!allowed)
    return (
      <p className="text-sm text-muted-foreground">
        Governance-Berichte sind nur für Administratoren und Entwickler sichtbar.
      </p>
    );

  return (
    <section className="space-y-4">
      <div>
        <h1 className="font-display text-xl font-semibold">KI-Governance</h1>
        <p className="text-sm text-muted-foreground">
          {openTotal ? `${openTotal} Scope${openTotal === 1 ? "" : "s"} mit offenen Prüfungen.` : "Keine offenen Prüfungen."}
        </p>
      </div>
      <div className="space-y-2">
        <div className="flex flex-wrap gap-2" aria-label="Risikostufe">
          <Chip active={risk === "all"} onClick={() => setRisk("all")}>Alle Stufen</Chip>
          {RISK_TIERS.map((t) => (
            <Chip key={t} active={risk === t} onClick={() => setRisk(t)}>{RISK_LABEL[t]}</Chip>
          ))}
        </div>
        <div className="flex flex-wrap gap-2" aria-label="Freigabestatus">
          <Chip active={status === "all"} onClick={() => setStatus("all")}>Jeder Status</Chip>
          {LIFECYCLES.map((l) => (
            <Chip key={l} active={status === l} onClick={() => setStatus(l)}>{LIFECYCLE_LABEL[l]}</Chip>
          ))}
          <Chip active={onlyOpen} onClick={() => setOnlyOpen((v) => !v)}>Nur offene Prüfungen</Chip>
        </div>
      </div>

      {q.isLoading ? (
        <p className="text-sm text-muted-foreground">Wird geladen …</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">Keine Scopes für diese Auswahl.</p>
      ) : (
        <ul className="divide-y rounded-xl border bg-card">
          {rows.map((r) => (
            <li key={r.id} className="flex items-center gap-3 px-4 py-3">
              {r.open.length ? (
                <AlertTriangle className="size-4 shrink-0 text-destructive" aria-label="Offene Prüfung" />
              ) : (
                <CheckCircle2 className="size-4 shrink-0 text-muted-foreground" aria-label="Keine offene Prüfung" />
              )}
              <div className="min-w-0 flex-1">
                <Link to="/board/$boardId" params={{ boardId: r.id }} className="block truncate text-sm font-medium hover:underline">
                  {r.title}
                </Link>
                <p className="truncate text-xs text-muted-foreground">
                  {RISK_LABEL[r.governance.riskTier]} · {LIFECYCLE_LABEL[r.governance.lifecycle]}
                  {r.open.length ? ` · ${r.open.join(", ")}` : ""}
                </p>
              </div>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button size="icon" variant="ghost" aria-label={`Governance-Nachweis für ${r.title} als PDF`} disabled={busy === r.id} onClick={() => void pdf(r.id)}>
                    {busy === r.id ? <Loader2 className="size-4 animate-spin" /> : <FileDown className="size-4" />}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Nachweis als PDF</TooltipContent>
              </Tooltip>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
