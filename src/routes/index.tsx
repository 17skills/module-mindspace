import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Pencil } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScopePreview } from "@/components/ScopePreview";
import { UserMenu } from "@/components/UserMenu";
import { GlobalSearch } from "@/components/GlobalSearch";
import { importBoard } from "@/lib/backup.functions";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "scopebuilder – deine Scopes und Apps" },
      {
        name: "description",
        content:
          "Baue Scopes aus Daten, Karten, Kennzahlen und Befunden – und liefere daraus Apps für Team und KI-Assistenten aus.",
      },
      { property: "og:title", content: "scopebuilder – deine Scopes und Apps" },
      {
        property: "og:description",
        content:
          "Das Studio für Scopes: Module verbinden, rechnen lassen und als App oder KI-Anschluss ausliefern.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: LibraryPage,
});

function LibraryPage() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<{ kind: "scope" | "app"; id: string } | null>(null);
  const [draft, setDraft] = useState("");
  const restoreRef = useRef<HTMLInputElement>(null);

  const restoreBackup = useMutation({
    mutationFn: async (file: File) => {
      const text = await file.text();
      const m = await import("@/lib/runtime/manifest");
      const { catalogVersions } = await import("@/lib/runtime/catalog/instantiate");
      let parsed: { manifest: import("@/lib/runtime/manifest").ScopeManifest; warnings: string[] } | null = null;
      const specMod = await import("@/lib/runtime/scope-spec");
      if (m.isManifestText(text)) {
        parsed = m.parseManifest(text);
      } else if (specMod.isScopeSpecText(text)) {
        // Prozess-Bauplan (.scope.yaml): gegen den Katalog prüfen, dann derselbe Weg.
        const { coreCatalog } = await import("@/lib/runtime/catalog");
        const spec = specMod.parseScopeSpec(text);
        const catalog = coreCatalog();
        const check = specMod.validateScopeSpec(spec, catalog);
        if (check.errors.length) {
          throw new Error(`Bauplan kann nicht aufgebaut werden: ${check.errors.slice(0, 3).join(" ")}`);
        }
        parsed = { manifest: specMod.scopeSpecToManifest(spec, catalog), warnings: check.warnings };
      }
      if (parsed) {
        const { manifest, warnings } = parsed;
        const notes = [...warnings, ...m.manifestNotices(manifest, catalogVersions())];
        const origin = manifest.provenance
          ? `\nVersion ${manifest.provenance.version}${manifest.provenance.author ? ` von ${manifest.provenance.author}` : ""}.`
          : "";
        const hint = notes.length ? `\n\nHinweise:\n• ${notes.slice(0, 6).join("\n• ")}` : "";
        const ok = window.confirm(
          `Bauplan „${manifest.scope.title}“ einspielen?${origin}\n\nEs wird ein neuer Scope angelegt: ${m.summarizeManifest(manifest)}.\nSchlüssel, Passwörter und Freigaben aus der Datei werden nicht übernommen. Apps werden nicht öffentlich – veröffentlichen Sie sie danach bewusst.${hint}`,
        );
        if (!ok) return null;
        return importBoard({ data: { backupJson: JSON.stringify(m.manifestToBackup(manifest)) } });
      }
      return importBoard({ data: { backupJson: text } });
    },
    onSuccess: (result) => {
      if (!result) return;
      toast.success(
        `Aufgebaut: ${result.nodes} Module, ${result.edges} Verbindungen, ${result.apps} Apps` +
          (result.missingServers
            ? ` – MCP-Server fehlt noch: ${result.missingServerNames.join(", ")} (unter Konto → MCP verbinden)`
            : ""),
      );
      void navigate({ to: "/board/$boardId", params: { boardId: result.boardId } });
    },
    onError: (error) => toast.error(error.message),
  });

  useEffect(() => {
    if (!loading && !user) void navigate({ to: "/auth" });
  }, [loading, user, navigate]);

  const boards = useQuery({
    queryKey: ["boards", user?.id],
    enabled: Boolean(user),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("boards")
        .select("id,title,description,updated_at,user_id")
        .order("updated_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const moduleTypes = useQuery({
    queryKey: ["board-module-types", user?.id],
    enabled: Boolean(user),
    queryFn: async () => {
      const { data, error } = await supabase.from("nodes").select("board_id,type");
      if (error) throw error;
      const map: Record<string, string[]> = {};
      for (const row of data ?? []) {
        const list = (map[row.board_id] ??= []);
        if (list.length < 6) list.push(row.type);
      }
      return map;
    },
  });

  const apps = useQuery({
    queryKey: ["apps", user?.id],
    enabled: Boolean(user),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("apps")
        .select("id,title,description,kind,node_ids,mcp_scope,is_public,updated_at")
        .order("updated_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const createBoard = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase
        .from("boards")
        .insert({ user_id: user!.id, title: "Neuer Scope" })
        .select("id")
        .single();
      if (error) throw error;
      return data.id as string;
    },
    onSuccess: (id) => navigate({ to: "/board/$boardId", params: { boardId: id } }),
    onError: (error) => toast.error(error.message),
  });

  const deleteBoard = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("boards").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["boards"] }),
    onError: (error) => toast.error(error.message),
  });

  const togglePublic = useMutation({
    mutationFn: async (app: { id: string; is_public: boolean }) => {
      const { error } = await supabase
        .from("apps")
        .update({ is_public: !app.is_public, updated_at: new Date().toISOString() })
        .eq("id", app.id);
      if (error) throw error;
      return !app.is_public;
    },
    onSuccess: (next) => {
      toast.success(next ? "App ist öffentlich erreichbar" : "App ist abgeschaltet");
      void queryClient.invalidateQueries({ queryKey: ["apps"] });
    },
    onError: (error) => toast.error(error.message),
  });

  const saveDescription = useMutation({
    mutationFn: async (target: { kind: "scope" | "app"; id: string; text: string }) => {
      const table = target.kind === "scope" ? "boards" : "apps";
      const { error } = await supabase
        .from(table)
        .update({ description: target.text })
        .eq("id", target.id);
      if (error) throw error;
      return target;
    },
    onSuccess: (target) => {
      setEditing(null);
      void queryClient.invalidateQueries({
        queryKey: [target.kind === "scope" ? "boards" : "apps"],
      });
    },
    onError: (error) => toast.error(error.message),
  });

  if (loading || !user) {
    return <div className="flex min-h-screen items-center justify-center text-muted-foreground">…</div>;
  }

  return (
    <main className="min-h-screen bg-background">
      <header className="border-b bg-card/70 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-brand-navy text-sm text-brand-navy-foreground">
              ✦
            </span>
            <span className="font-display text-lg font-semibold tracking-tight text-brand-navy">
              scopebuilder
            </span>
          </div>
          <div className="flex items-center gap-3">
            <GlobalSearch />
            <span className="hidden text-sm text-muted-foreground sm:inline">{user.email}</span>
            <UserMenu />
          </div>
        </div>
      </header>

      <section className="mx-auto max-w-5xl px-6 py-12">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="font-display text-3xl font-semibold tracking-tight text-brand-navy">
              Deine Scopes
            </h1>
            <p className="mt-1 text-muted-foreground">
              Ein Scope pro Thema: Daten, Karten, Kennzahlen, Befunde und Chat – das Studio für
              deine Apps.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button asChild variant="outline">
              <Link to="/ergebnisse">Ergebnisse</Link>
            </Button>

            <input
              ref={restoreRef}
              type="file"
              accept="application/json,.json,.yaml,.yml,.md,text/markdown"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) restoreBackup.mutate(file);
                event.target.value = "";
              }}
            />
            <Button
              variant="outline"
              onClick={() => restoreRef.current?.click()}
              disabled={restoreBackup.isPending}
            >
              Sicherung oder Bauplan einspielen
            </Button>
            <Button onClick={() => createBoard.mutate()} disabled={createBoard.isPending}>
              Neuer Scope
            </Button>
          </div>
        </div>

        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {boards.data?.map((board) => (
            <div
              key={board.id}
              className="group rounded-2xl border bg-card p-4 shadow-[var(--shadow-card)] transition hover:-translate-y-0.5 hover:shadow-[var(--shadow-float)]"
            >
              <Link to="/board/$boardId" params={{ boardId: board.id }} className="block">
                <ScopePreview
                  seed={board.id}
                  types={moduleTypes.data?.[board.id] ?? []}
                  label="Scope"
                  className="mb-3 h-24"
                />
                <div className="flex items-center gap-2">
                  <h2 className="font-display text-lg font-semibold">{board.title}</h2>
                  {board.user_id !== user.id && (
                    <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                      Geteilt
                    </span>
                  )}
                </div>
              </Link>

              {editing?.kind === "scope" && editing.id === board.id ? (
                <div className="mt-2 space-y-2">
                  <Textarea
                    autoFocus
                    rows={3}
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    placeholder="Worum geht es in diesem Scope?"
                  />
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      onClick={() =>
                        saveDescription.mutate({ kind: "scope", id: board.id, text: draft })
                      }
                    >
                      Speichern
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>
                      Abbrechen
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="mt-1 flex items-start gap-2">
                  <p className="line-clamp-2 flex-1 text-sm text-muted-foreground">
                    {board.description || "Ohne Beschreibung"}
                  </p>
                  <button
                    title="Beschreibung bearbeiten"
                    className="text-muted-foreground opacity-0 transition group-hover:opacity-100 hover:text-foreground"
                    onClick={() => {
                      setEditing({ kind: "scope", id: board.id });
                      setDraft(board.description ?? "");
                    }}
                  >
                    <Pencil className="size-3.5" />
                  </button>
                </div>
              )}

              <p className="mt-3 text-xs text-muted-foreground">
                Zuletzt geändert {new Date(board.updated_at).toLocaleDateString("de-DE")}
              </p>

              {board.user_id === user.id && (
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <button className="mt-3 text-xs text-muted-foreground opacity-0 transition group-hover:opacity-100 hover:text-destructive">
                      Löschen
                    </button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Scope löschen?</AlertDialogTitle>
                      <AlertDialogDescription>
                        Alle Module, Verbindungen und Chats dieses Scopes werden entfernt.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Abbrechen</AlertDialogCancel>
                      <AlertDialogAction onClick={() => deleteBoard.mutate(board.id)}>
                        Löschen
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              )}
            </div>
          ))}

          {boards.data?.length === 0 && (
            <div className="col-span-full rounded-2xl border border-dashed p-12 text-center text-muted-foreground">
              Noch kein Scope. Lege deinen ersten an und ziehe Inhalte hinein.
            </div>
          )}
        </div>

        <div className="mt-14">
          <h2 className="font-display text-xl font-semibold tracking-tight text-brand-navy">
            Aktive Apps
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Aus Modulen gebaute Apps – als Link für Menschen und als Datenzugang für KI-Assistenten.
          </p>
          <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {apps.data?.map((app) => (
              <div
                key={app.id}
                className="group rounded-2xl border bg-card p-4 shadow-[var(--shadow-card)]"
              >
                <ScopePreview
                  seed={app.id}
                  types={app.kind === "capture" ? ["inspect", "map", "note"] : ["map", "metric", "risk"]}
                  label={app.kind === "capture" ? "Erfassung" : "Cockpit"}
                  className="mb-3 h-24"
                />
                <div className="flex items-center gap-2">
                  <h3 className="font-display text-base font-semibold">{app.title}</h3>
                  <span
                    className={`rounded-full px-2 py-0.5 text-[11px] ${
                      app.is_public
                        ? "bg-brand-sage/20 text-brand-navy"
                        : "bg-muted text-muted-foreground"
                    }`}
                  >
                    {app.is_public ? "Aktiv" : "Inaktiv"}
                  </span>
                  <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                    {app.mcp_scope === "write" ? "KI schreibt" : "KI liest"}
                  </span>
                </div>

                {editing?.kind === "app" && editing.id === app.id ? (
                  <div className="mt-2 space-y-2">
                    <Textarea
                      autoFocus
                      rows={3}
                      value={draft}
                      onChange={(event) => setDraft(event.target.value)}
                      placeholder="Wofür ist diese App gedacht?"
                    />
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        onClick={() =>
                          saveDescription.mutate({ kind: "app", id: app.id, text: draft })
                        }
                      >
                        Speichern
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>
                        Abbrechen
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="mt-1 flex items-start gap-2">
                    <p className="line-clamp-2 flex-1 text-sm text-muted-foreground">
                      {app.description || "Ohne Beschreibung"}
                    </p>
                    <button
                      title="Beschreibung bearbeiten"
                      className="text-muted-foreground opacity-0 transition group-hover:opacity-100 hover:text-foreground"
                      onClick={() => {
                        setEditing({ kind: "app", id: app.id });
                        setDraft(app.description ?? "");
                      }}
                    >
                      <Pencil className="size-3.5" />
                    </button>
                  </div>
                )}

                <p className="mt-2 text-xs text-muted-foreground">
                  {Array.isArray(app.node_ids) ? app.node_ids.length : 0} Module ·{" "}
                  {new Date(app.updated_at).toLocaleDateString("de-DE")}
                </p>
                <div className="mt-3 flex gap-2">
                  <Button size="sm" variant="outline" asChild>
                    <a href={`/app/${app.id}`} target="_blank" rel="noreferrer">
                      Öffnen
                    </a>
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      void navigator.clipboard.writeText(`${window.location.origin}/app/${app.id}`);
                      toast.success("Link kopiert");
                    }}
                  >
                    Link kopieren
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={togglePublic.isPending}
                    onClick={() =>
                      togglePublic.mutate({ id: app.id, is_public: app.is_public })
                    }
                  >
                    {app.is_public ? "Abschalten" : "Aktivieren"}
                  </Button>
                </div>
              </div>
            ))}
            {apps.data?.length === 0 && (
              <div className="col-span-full rounded-2xl border border-dashed p-8 text-center text-sm text-muted-foreground">
                Noch keine App. Wähle in einem Scope Module aus und klicke unten auf „App-Ansicht“.
              </div>
            )}
          </div>
        </div>
      </section>

      <footer className="border-t">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-4 px-6 py-6 text-sm text-muted-foreground">
          <Link to="/datenschutz" className="underline-offset-4 hover:underline">
            Datenschutz
          </Link>
          <Link to="/impressum" className="underline-offset-4 hover:underline">
            Impressum
          </Link>
          <Link to="/agb" className="underline-offset-4 hover:underline">
            Nutzungsbedingungen
          </Link>
        </div>
      </footer>
    </main>
  );
}
