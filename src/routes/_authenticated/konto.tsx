import { createFileRoute, Link, Outlet, useRouterState } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { getAccount } from "@/lib/account.functions";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_authenticated/konto")({
  head: () => ({
    meta: [
      { title: "Konto & Einstellungen — scopebuilder" },
      {
        name: "description",
        content: "Profil, Team-Mitglieder, App-Zugänge, Datenschutz und persönliche Einstellungen.",
      },
      { property: "og:title", content: "Konto & Einstellungen — scopebuilder" },
      {
        property: "og:description",
        content: "Profil, Team-Mitglieder, App-Zugänge, Datenschutz und persönliche Einstellungen.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: KontoLayout,
});

const TABS = [
  { to: "/konto", label: "Profil", exact: true },
  { to: "/konto/einstellungen", label: "Einstellungen" },
  { to: "/konto/mitglieder", label: "Mitglieder" },
  { to: "/konto/apps", label: "App-Zugänge" },
  { to: "/konto/datenschutz", label: "Datenschutz" },
] as const;

function KontoLayout() {
  const account = useQuery({ queryKey: ["account"], queryFn: () => getAccount() });
  const pathname = useRouterState({ select: (state) => state.location.pathname });

  return (
    <main className="min-h-screen bg-background">
      <header className="border-b bg-card/70 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-6 py-4">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" asChild>
              <Link to="/">
                <ArrowLeft className="mr-1.5 h-4 w-4" aria-hidden="true" />
                Scopes
              </Link>
            </Button>
            <span className="font-display text-lg font-semibold tracking-tight text-brand-navy">
              Konto
            </span>
          </div>
          <span className="hidden text-sm text-muted-foreground sm:inline">
            {account.data?.email}
          </span>
        </div>
        <nav aria-label="Konto-Bereiche" className="mx-auto max-w-5xl overflow-x-auto px-6">
          <ul className="flex gap-1 pb-2">
            {[...TABS, ...(account.data?.isAdmin ? [{ to: "/konto/admin", label: "Administration" } as const] : [])].map(
              (tab) => {
                const active = "exact" in tab && tab.exact ? pathname === tab.to : pathname.startsWith(tab.to);
                return (
                  <li key={tab.to}>
                    <Link
                      to={tab.to}
                      className={`inline-block rounded-lg px-3 py-1.5 text-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                        active
                          ? "bg-brand-navy text-brand-navy-foreground"
                          : "text-muted-foreground hover:bg-muted"
                      }`}
                      aria-current={active ? "page" : undefined}
                    >
                      {tab.label}
                    </Link>
                  </li>
                );
              },
            )}
          </ul>
        </nav>
      </header>

      <section className="mx-auto max-w-5xl px-6 py-10">
        <Outlet />
      </section>
    </main>
  );
}
