import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable/index";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/** Only same-origin relative paths are accepted as a return target. */
function safeNext(raw: unknown): string | null {
  return typeof raw === "string" && raw.startsWith("/") && !raw.startsWith("//") ? raw : null;
}

export const Route = createFileRoute("/auth")({
  validateSearch: (s: Record<string, unknown>): { next?: string } => {
    const next = safeNext(s["next"]);
    return next ? { next } : {};
  },
  head: () => ({
    meta: [
      { title: "Anmelden – Canvas Spark" },
      {
        name: "description",
        content: "Melde dich an, um deine Wissens-Boards mit Videos, Podcasts und Dokumenten zu öffnen.",
      },
      { property: "og:title", content: "Anmelden – Canvas Spark" },
      {
        property: "og:description",
        content: "Zugang zu deiner persönlichen Wissens-Bibliothek auf Canvas Spark.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const { next } = Route.useSearch();
  const { user, loading } = useAuth();
  const target = safeNext(next);
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  function done() {
    if (target) {
      window.location.href = target;
      return;
    }
    void navigate({ to: "/" });
  }

  useEffect(() => {
    if (!loading && user) done();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, user]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: target ? window.location.origin + target : window.location.origin },
        });
        if (error) throw error;
        toast.success("Fast fertig", {
          description: "Bitte bestätige die E-Mail, die wir dir geschickt haben.",
        });
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        done();
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Anmeldung fehlgeschlagen");
    } finally {
      setBusy(false);
    }
  }

  async function google() {
    const result = await lovable.auth.signInWithOAuth("google", {
      redirect_uri: target ? window.location.origin + target : window.location.origin,
    });
    if (result.error) {
      toast.error("Google-Anmeldung fehlgeschlagen");
      return;
    }
    if (result.redirected) return;
    done();
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4 py-16">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-11 w-11 items-center justify-center rounded-2xl bg-primary text-lg font-semibold text-primary-foreground">
            ✦
          </div>
          <h1 className="font-display text-2xl font-semibold tracking-tight text-brand-navy">
            Canvas Spark
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Deine Inhalte auf einer Fläche – verbunden und mit KI auswertbar.
          </p>
        </div>

        <div className="rounded-2xl border bg-card p-6 shadow-[var(--shadow-card)]">
          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">E-Mail</Label>
              <Input
                id="email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="du@beispiel.de"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Passwort</Label>
              <Input
                id="password"
                type="password"
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
              />
            </div>
            <Button type="submit" className="w-full" disabled={busy}>
              {mode === "signin" ? "Anmelden" : "Konto erstellen"}
            </Button>
          </form>

          <div className="my-5 flex items-center gap-3 text-xs text-muted-foreground">
            <span className="h-px flex-1 bg-border" />
            oder
            <span className="h-px flex-1 bg-border" />
          </div>

          <Button variant="outline" className="w-full" onClick={google} type="button">
            Weiter mit Google
          </Button>

          <button
            type="button"
            className="mt-5 w-full text-center text-sm text-muted-foreground hover:text-foreground"
            onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
          >
            {mode === "signin"
              ? "Noch kein Konto? Jetzt registrieren"
              : "Schon registriert? Zur Anmeldung"}
          </button>
        </div>
      </div>
    </main>
  );
}
