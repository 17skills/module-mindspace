import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  BarChart3,
  ExternalLink,
  FileText,
  Folder,
  FolderPlus,
  LayoutGrid,
  Link2,
  List as ListIcon,
  MoreHorizontal,
  Pencil,
  Plus,
  Power,
  Search,
  Trash2,
  Upload,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
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

/** Mitgelieferte Prozess-Baupläne; eingespielt über denselben Weg wie eine Datei. */
const BLUEPRINTS: Record<string, string> = Object.fromEntries(
  Object.entries(
    import.meta.glob("/templates/*.scope.yaml", { query: "?raw", import: "default", eager: true }) as Record<string, string>,
  ).map(([path, text]) => [path.split("/").pop()!.replace(".scope.yaml", ""), text]),
);

function blueprintTitle(text: string, fallback: string): string {
  const match = /^\s*title:\s*["']?(.+?)["']?\s*$/m.exec(text);
  return match?.[1] ?? fallback;
}

function LibraryPage() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<{ kind: "scope" | "app"; id: string } | null>(null);
  const [draft, setDraft] = useState("");
  const restoreRef = useRef<HTMLInputElement>(null);
  const [view, setView] = useState<"gallery" | "list">("gallery");
  const [search, setSearch] = useState("");
  const [owner, setOwner] = useState<"all" | "mine" | "shared">("all");
  const [projectFilter, setProjectFilter] = useState<string | null>(null);
  const [extraProjects, setExtraProjects] = useState<string[]>([]);
  const [newProject, setNewProject] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [appFilter, setAppFilter] = useState<"all" | "active" | "inactive">("all");

  useEffect(() => {
    const stored = window.localStorage.getItem("scopes-view");
    if (stored === "list" || stored === "gallery") setView(stored);
  }, []);

  function changeView(next: "gallery" | "list") {
    setView(next);
    window.localStorage.setItem("scopes-view", next);
  }


  const restoreBackup = useMutation({
    mutationFn: async (file: File | string) => {
      const text = typeof file === "string" ? file : await file.text();
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
        .select("id,title,description,updated_at,user_id,project")
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

  const setProject = useMutation({
    mutationFn: async (target: { id: string; project: string | null }) => {
      const { error } = await supabase
        .from("boards")
        .update({ project: target.project })
        .eq("id", target.id);
      if (error) throw error;
      return target;
    },
    onSuccess: (target) => {
      toast.success(target.project ? `In „${target.project}“ verschoben` : "Aus Projekt entfernt");
      void queryClient.invalidateQueries({ queryKey: ["boards"] });
    },
    onError: (error) => toast.error(error.message),
  });

  const projectNames = useMemo(() => {
    const names = new Set<string>(extraProjects);
    for (const board of boards.data ?? []) if (board.project) names.add(board.project);
    return [...names].sort((a, b) => a.localeCompare(b, "de"));
  }, [boards.data, extraProjects]);

  const visibleBoards = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (boards.data ?? []).filter((board) => {
      if (owner === "mine" && board.user_id !== user?.id) return false;
      if (owner === "shared" && board.user_id === user?.id) return false;
      if (projectFilter && board.project !== projectFilter) return false;
      if (!term) return true;
      return `${board.title} ${board.description ?? ""}`.toLowerCase().includes(term);
    });
  }, [boards.data, owner, projectFilter, search, user?.id]);

  const visibleApps = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (apps.data ?? []).filter((app) => {
      if (appFilter === "active" && !app.is_public) return false;
      if (appFilter === "inactive" && app.is_public) return false;
      if (!term) return true;
      return `${app.title} ${app.description ?? ""}`.toLowerCase().includes(term);
    });
  }, [apps.data, appFilter, search]);

  function copyAppLink(id: string) {
    void navigator.clipboard.writeText(`${window.location.origin}/app/${id}`);
    toast.success("Link kopiert");
  }

  function appMenu(app: { id: string; description: string | null; is_public: boolean }) {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" aria-label="App-Menü">
            <MoreHorizontal aria-hidden="true" className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuItem onSelect={() => window.open(`/app/${app.id}`, "_blank", "noreferrer")}>
            <ExternalLink aria-hidden="true" className="mr-2 h-4 w-4" />
            Öffnen
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => copyAppLink(app.id)}>
            <Link2 aria-hidden="true" className="mr-2 h-4 w-4" />
            Link kopieren
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => {
              setEditing({ kind: "app", id: app.id });
              setDraft(app.description ?? "");
            }}
          >
            <Pencil aria-hidden="true" className="mr-2 h-4 w-4" />
            Beschreibung bearbeiten
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            disabled={togglePublic.isPending}
            onSelect={() => togglePublic.mutate({ id: app.id, is_public: app.is_public })}
          >
            <Power aria-hidden="true" className="mr-2 h-4 w-4" />
            {app.is_public ? "Abschalten" : "Aktivieren"}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  function boardMenu(board: { id: string; description: string | null; user_id: string }) {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" aria-label="Scope-Menü">
            <MoreHorizontal aria-hidden="true" className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuItem
            onSelect={() => {
              setEditing({ kind: "scope", id: board.id });
              setDraft(board.description ?? "");
            }}
          >
            <Pencil aria-hidden="true" className="mr-2 h-4 w-4" />
            Beschreibung bearbeiten
          </DropdownMenuItem>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <Folder aria-hidden="true" className="mr-2 h-4 w-4" />
              Projekt zuordnen
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              {projectNames.map((name) => (
                <DropdownMenuItem
                  key={name}
                  onSelect={() => setProject.mutate({ id: board.id, project: name })}
                >
                  {name}
                </DropdownMenuItem>
              ))}
              {projectNames.length > 0 && <DropdownMenuSeparator />}
              <DropdownMenuItem onSelect={() => setNewProject("")}>
                <FolderPlus aria-hidden="true" className="mr-2 h-4 w-4" />
                Neues Projekt …
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setProject.mutate({ id: board.id, project: null })}>
                Kein Projekt
              </DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          {board.user_id === user?.id && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                onSelect={() => setConfirmDelete(board.id)}
              >
                <Trash2 aria-hidden="true" className="mr-2 h-4 w-4" />
                Löschen
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

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
          <div className="flex items-center gap-2">
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
            <Button onClick={() => createBoard.mutate()} disabled={createBoard.isPending}>
              <Plus aria-hidden="true" className="mr-1 h-4 w-4" />
              Neuer Scope
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="icon" aria-label="Weitere Aktionen">
                  <MoreHorizontal aria-hidden="true" className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-64">
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger disabled={restoreBackup.isPending}>
                    <FileText aria-hidden="true" className="mr-2 h-4 w-4" />
                    Aus Scope-Template erstellen
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent>
                    {Object.keys(BLUEPRINTS).map((name) => (
                      <DropdownMenuItem
                        key={name}
                        onSelect={() => restoreBackup.mutate(BLUEPRINTS[name]!)}
                      >
                        {blueprintTitle(BLUEPRINTS[name]!, name)}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
                <DropdownMenuItem
                  disabled={restoreBackup.isPending}
                  onSelect={() => restoreRef.current?.click()}
                >
                  <Upload aria-hidden="true" className="mr-2 h-4 w-4" />
                  Scope-Template oder Sicherung einspielen …
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => setNewProject("")}>
                  <FolderPlus aria-hidden="true" className="mr-2 h-4 w-4" />
                  Neues Projekt anlegen …
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => void navigate({ to: "/ergebnisse" })}>
                  <BarChart3 aria-hidden="true" className="mr-2 h-4 w-4" />
                  Ergebnisse anzeigen
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => void navigate({ to: "/konto/governance" })}>
                  <BarChart3 aria-hidden="true" className="mr-2 h-4 w-4" />
                  KI-Governance
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        <div className="mt-6 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
          <div className="relative min-w-0">
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Scopes und Apps durchsuchen"
              aria-label="Scopes und Apps durchsuchen"
              className="pl-9"
            />
          </div>
          <div className="flex shrink-0 items-center gap-1 rounded-lg border p-0.5">
            <Button
              size="icon"
              variant={view === "gallery" ? "secondary" : "ghost"}
              aria-label="Galerie-Ansicht"
              aria-pressed={view === "gallery"}
              className="h-8 w-8"
              onClick={() => changeView("gallery")}
            >
              <LayoutGrid aria-hidden="true" className="h-4 w-4" />
            </Button>
            <Button
              size="icon"
              variant={view === "list" ? "secondary" : "ghost"}
              aria-label="Listen-Ansicht"
              aria-pressed={view === "list"}
              className="h-8 w-8"
              onClick={() => changeView("list")}
            >
              <ListIcon aria-hidden="true" className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          {(
            [
              { id: "all", label: "Alle" },
              { id: "mine", label: "Meine" },
              { id: "shared", label: "Geteilt" },
            ] as const
          ).map((option) => (
            <button
              key={option.id}
              onClick={() => setOwner(option.id)}
              aria-pressed={owner === option.id}
              className={`rounded-full border px-3 py-1 text-xs transition ${
                owner === option.id
                  ? "border-transparent bg-brand-navy text-brand-navy-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {option.label}
            </button>
          ))}
          {projectNames.length > 0 && <span className="mx-1 h-4 w-px bg-border" />}
          {projectNames.map((name) => (
            <button
              key={name}
              onClick={() => setProjectFilter((current) => (current === name ? null : name))}
              aria-pressed={projectFilter === name}
              className={`inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs transition ${
                projectFilter === name
                  ? "border-transparent bg-brand-navy text-brand-navy-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Folder aria-hidden="true" className="h-3 w-3" />
              {name}
            </button>
          ))}
        </div>

        {view === "gallery" ? (
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {visibleBoards.map((board) => (
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
                </Link>
                <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-2">
                  <div className="min-w-0">
                    <Link
                      to="/board/$boardId"
                      params={{ boardId: board.id }}
                      className="font-display text-lg font-semibold hover:underline"
                    >
                      {board.title}
                    </Link>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      {board.project && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                          <Folder aria-hidden="true" className="h-3 w-3" />
                          {board.project}
                        </span>
                      )}
                      {board.user_id !== user.id && (
                        <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                          Geteilt
                        </span>
                      )}
                    </div>
                  </div>
                  {boardMenu(board)}
                </div>

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
                  <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">
                    {board.description || "Ohne Beschreibung"}
                  </p>
                )}

                <p className="mt-3 text-xs text-muted-foreground">
                  Zuletzt geändert {new Date(board.updated_at).toLocaleDateString("de-DE")}
                </p>
              </div>
            ))}

            {visibleBoards.length === 0 && (
              <div className="col-span-full rounded-2xl border border-dashed p-12 text-center text-muted-foreground">
                {boards.data?.length
                  ? "Kein Scope passt zu Suche und Filter."
                  : "Noch kein Scope. Lege deinen ersten an und ziehe Inhalte hinein."}
              </div>
            )}
          </div>
        ) : (
          <div className="mt-6 divide-y rounded-2xl border bg-card">
            {visibleBoards.map((board) => (
              <div
                key={board.id}
                className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 px-4 py-3"
              >
                <div className="min-w-0">
                  <Link
                    to="/board/$boardId"
                    params={{ boardId: board.id }}
                    className="block truncate font-medium hover:underline"
                  >
                    {board.title}
                  </Link>
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">
                    {board.project ? `${board.project} · ` : ""}
                    {moduleTypes.data?.[board.id]?.length ?? 0} Module ·{" "}
                    {new Date(board.updated_at).toLocaleDateString("de-DE")}
                    {board.user_id !== user.id ? " · Geteilt" : ""}
                  </p>
                </div>
                {boardMenu(board)}
              </div>
            ))}
            {visibleBoards.length === 0 && (
              <div className="p-8 text-center text-sm text-muted-foreground">
                {boards.data?.length
                  ? "Kein Scope passt zu Suche und Filter."
                  : "Noch kein Scope. Lege deinen ersten an."}
              </div>
            )}
          </div>
        )}

        <AlertDialog
          open={Boolean(confirmDelete)}
          onOpenChange={(open) => !open && setConfirmDelete(null)}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Scope löschen?</AlertDialogTitle>
              <AlertDialogDescription>
                Alle Module, Verbindungen und Chats dieses Scopes werden entfernt.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Abbrechen</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => {
                  if (confirmDelete) deleteBoard.mutate(confirmDelete);
                  setConfirmDelete(null);
                }}
              >
                Löschen
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <Dialog open={newProject !== null} onOpenChange={(open) => !open && setNewProject(null)}>
          <DialogContent className="sm:max-w-sm">
            <DialogHeader>
              <DialogTitle>Neues Projekt</DialogTitle>
              <DialogDescription>
                Ein Projekt bündelt mehrere Scopes. Du ordnest Scopes danach über ihr Menü zu.
              </DialogDescription>
            </DialogHeader>
            <Input
              autoFocus
              value={newProject ?? ""}
              onChange={(event) => setNewProject(event.target.value)}
              placeholder="z. B. Instandhaltung 2026"
            />
            <DialogFooter>
              <Button variant="ghost" onClick={() => setNewProject(null)}>
                Abbrechen
              </Button>
              <Button
                disabled={!newProject?.trim()}
                onClick={() => {
                  const name = newProject!.trim();
                  setExtraProjects((current) =>
                    current.includes(name) ? current : [...current, name],
                  );
                  setProjectFilter(name);
                  setNewProject(null);
                  toast.success(`Projekt „${name}“ angelegt – ordne Scopes über ihr Menü zu.`);
                }}
              >
                Anlegen
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>


        <div className="mt-14">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="font-display text-xl font-semibold tracking-tight text-brand-navy">
                Aktive Apps
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Aus Modulen gebaute Apps – als Link für Menschen und als Datenzugang für
                KI-Assistenten.
              </p>
            </div>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            {(
              [
                { id: "all", label: "Alle" },
                { id: "active", label: "Aktiv" },
                { id: "inactive", label: "Inaktiv" },
              ] as const
            ).map((option) => (
              <button
                key={option.id}
                onClick={() => setAppFilter(option.id)}
                aria-pressed={appFilter === option.id}
                className={`rounded-full border px-3 py-1 text-xs transition ${
                  appFilter === option.id
                    ? "border-transparent bg-brand-navy text-brand-navy-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>

          {view === "gallery" ? (
            <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {visibleApps.map((app) => (
                <div
                  key={app.id}
                  className="group rounded-2xl border bg-card p-4 shadow-[var(--shadow-card)] transition hover:-translate-y-0.5 hover:shadow-[var(--shadow-float)]"
                >
                  <a href={`/app/${app.id}`} target="_blank" rel="noreferrer" className="block">
                    <ScopePreview
                      seed={app.id}
                      types={
                        app.kind === "capture"
                          ? ["inspect", "map", "note"]
                          : ["map", "metric", "risk"]
                      }
                      label={app.kind === "capture" ? "Erfassung" : "Cockpit"}
                      className="mb-3 h-24"
                    />
                  </a>
                  <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-2">
                    <div className="min-w-0">
                      <a
                        href={`/app/${app.id}`}
                        target="_blank"
                        rel="noreferrer"
                        className="font-display text-base font-semibold hover:underline"
                      >
                        {app.title}
                      </a>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5">
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
                    </div>
                    {appMenu(app)}
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
                    <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">
                      {app.description || "Ohne Beschreibung"}
                    </p>
                  )}

                  <p className="mt-3 text-xs text-muted-foreground">
                    {Array.isArray(app.node_ids) ? app.node_ids.length : 0} Module ·{" "}
                    {new Date(app.updated_at).toLocaleDateString("de-DE")}
                  </p>
                </div>
              ))}
              {visibleApps.length === 0 && (
                <div className="col-span-full rounded-2xl border border-dashed p-8 text-center text-sm text-muted-foreground">
                  {apps.data?.length
                    ? "Keine App passt zu Suche und Filter."
                    : "Noch keine App. Wähle in einem Scope Module aus und klicke unten auf „App-Ansicht“."}
                </div>
              )}
            </div>
          ) : (
            <div className="mt-5 divide-y rounded-2xl border bg-card">
              {visibleApps.map((app) => (
                <div
                  key={app.id}
                  className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 px-4 py-3"
                >
                  <div className="min-w-0">
                    <a
                      href={`/app/${app.id}`}
                      target="_blank"
                      rel="noreferrer"
                      className="block truncate font-medium hover:underline"
                    >
                      {app.title}
                    </a>
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">
                      {app.is_public ? "Aktiv" : "Inaktiv"} ·{" "}
                      {app.kind === "capture" ? "Erfassung" : "Cockpit"} ·{" "}
                      {Array.isArray(app.node_ids) ? app.node_ids.length : 0} Module ·{" "}
                      {new Date(app.updated_at).toLocaleDateString("de-DE")}
                    </p>
                  </div>
                  {appMenu(app)}
                </div>
              ))}
              {visibleApps.length === 0 && (
                <div className="p-8 text-center text-sm text-muted-foreground">
                  {apps.data?.length
                    ? "Keine App passt zu Suche und Filter."
                    : "Noch keine App. Wähle in einem Scope Module aus."}
                </div>
              )}
            </div>
          )}
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
