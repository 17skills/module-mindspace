import { createFileRoute, redirect } from "@tanstack/react-router";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";

type OAuthClient = { name?: string };
type OAuthDetails = { client?: OAuthClient; redirect_url?: string; redirect_to?: string };
type OAuthResult = { data: OAuthDetails | null; error: { message: string } | null };
type OAuthApi = {
  getAuthorizationDetails: (id: string) => Promise<OAuthResult>;
  approveAuthorization: (id: string) => Promise<OAuthResult>;
  denyAuthorization: (id: string) => Promise<OAuthResult>;
};

function oauthApi(): OAuthApi {
  return (supabase.auth as unknown as { oauth: OAuthApi }).oauth;
}

export const Route = createFileRoute("/.lovable/oauth/consent")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Zugriff erlauben – Canvas Spark" },
      {
        name: "description",
        content: "Bestätige, dass eine verbundene Anwendung in deinem Namen auf deine Canvas-Spark-Boards zugreifen darf.",
      },
      { property: "og:title", content: "Zugriff erlauben – Canvas Spark" },
      {
        property: "og:description",
        content: "Freigabe für verbundene Anwendungen auf Canvas Spark.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  validateSearch: (s: Record<string, unknown>) => ({
    authorization_id: typeof s["authorization_id"] === "string" ? s["authorization_id"] : "",
  }),
  beforeLoad: async ({ search, location }) => {
    if (!search.authorization_id) throw new Error("Missing authorization_id");
    const { data } = await supabase.auth.getSession();
    const next = location.pathname + location.searchStr;
    if (!data.session) throw redirect({ to: "/auth", search: { next } });
  },
  loader: async ({ location }) => {
    const authorizationId = new URLSearchParams(location.search).get("authorization_id")!;
    const { data, error } = await oauthApi().getAuthorizationDetails(authorizationId);
    if (error) throw new Error(error.message);
    const immediate = data?.redirect_url ?? data?.redirect_to;
    if (immediate && !data?.client) throw redirect({ href: immediate });
    return data;
  },
  component: Consent,
  errorComponent: ({ error }) => (
    <main className="flex min-h-screen items-center justify-center px-4 text-sm text-muted-foreground">
      Diese Anfrage konnte nicht geladen werden: {String((error as Error)?.message ?? error)}
    </main>
  ),
});

function Consent() {
  const details = Route.useLoaderData();
  const { authorization_id } = Route.useSearch();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const name = details?.client?.name ?? "Eine Anwendung";

  async function decide(approve: boolean) {
    setBusy(true);
    const api = oauthApi();
    const { data, error: failure } = approve
      ? await api.approveAuthorization(authorization_id)
      : await api.denyAuthorization(authorization_id);
    if (failure) {
      setBusy(false);
      setError(failure.message);
      return;
    }
    const target = data?.redirect_url ?? data?.redirect_to;
    if (!target) {
      setBusy(false);
      setError("Der Anmeldedienst hat keine Rücksprungadresse geliefert.");
      return;
    }
    window.location.href = target;
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4 py-16">
      <div className="w-full max-w-sm rounded-2xl border bg-card p-6 shadow-[var(--shadow-card)]">
        <h1 className="font-display text-xl font-semibold tracking-tight text-brand-navy">
          {name} mit Canvas Spark verbinden
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {name} darf danach in deinem Namen deine Boards lesen und Notizen anlegen. Du kannst die
          Verbindung jederzeit widerrufen.
        </p>
        {error && (
          <p role="alert" className="mt-3 text-sm text-destructive">
            {error}
          </p>
        )}
        <div className="mt-6 flex gap-2">
          <Button className="flex-1" disabled={busy} onClick={() => void decide(true)}>
            Erlauben
          </Button>
          <Button variant="outline" className="flex-1" disabled={busy} onClick={() => void decide(false)}>
            Ablehnen
          </Button>
        </div>
      </div>
    </main>
  );
}
