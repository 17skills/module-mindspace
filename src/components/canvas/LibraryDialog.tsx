import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Copy,
  LayoutGrid,
  List as ListIcon,
  MoreHorizontal,
  Pencil,
  Share2,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import { NODE_LABEL } from "@/components/canvas/board-context";
import { LibraryPreview } from "@/components/canvas/LibraryPreview";
import {
  formatDate,
  rowToEntry,
  summarize,
  type LibraryEntry,
  type LibraryPayload,
} from "@/lib/library";
import {
  listEntryShares,
  listSharedEntries,
  removeEntryShare,
  shareLibraryEntry,
} from "@/lib/library.functions";
import { cn } from "@/lib/utils";
import { CatalogList } from "@/components/canvas/CatalogList";
import { shareLink } from "@/lib/share-link";
import { useTranslation } from "@/lib/i18n";

export type CapturedSelection = {
  payload: LibraryPayload;
  scope: "single" | "group";
  title: string;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userId: string | undefined;
  /** Current selection on the canvas, ready to be stored. */
  captureSelection: () => CapturedSelection | null;
  onInsert: (entry: LibraryEntry, mode: "empty" | "full") => void | Promise<void>;
  /** Place a building block from the core catalog. */
  onInsertModule?: ((name: string) => void | Promise<void>) | undefined;
};

const VIEW_KEY = "library-view";

function typeSummary(payload: LibraryPayload) {
  const counts = summarize(payload);
  return [...counts.entries()]
    .map(([type, count]) => `${count}× ${NODE_LABEL[type] ?? type}`)
    .slice(0, 4)
    .join(", ");
}

function EntryActions({
  entry,
  onEdit,
  onDuplicate,
  onShare,
  onDelete,
}: {
  entry: LibraryEntry;
  onEdit: () => void;
  onDuplicate: () => void;
  onShare: () => void;
  onDelete: () => void;
}) {
  const { l } = useTranslation();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="icon" variant="ghost" className="size-8 rounded-lg" aria-label={`Aktionen für ${entry.title}`}>
          <MoreHorizontal className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={onEdit}>
          <Pencil className="size-4" /> {l("Bearbeiten")}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onDuplicate}>
          <Copy className="size-4" /> {l("Duplizieren")}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onShare}>
          <Share2 className="size-4" /> {l("Teilen")}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onDelete}>
          <Trash2 className="size-4" /> {l("Löschen")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function Meta({ entry }: { entry: LibraryEntry }) {
  return (
    <p className="text-xs text-muted-foreground">
      {entry.payload.nodes.length} Module
      {entry.scope === "group" ? " · Gruppe" : " · Einzelmodul"}
      {entry.updatedAt ? ` · ${formatDate(entry.updatedAt)}` : ""}
      {typeSummary(entry.payload) ? ` · ${typeSummary(entry.payload)}` : ""}
    </p>
  );
}

export function LibraryDialog({ open, onOpenChange, userId, captureSelection, onInsert, onInsertModule }: Props) {
  const { l } = useTranslation();
  const [entries, setEntries] = useState<LibraryEntry[]>([]);
  const [shared, setShared] = useState<LibraryEntry[]>([]);
  const [view, setView] = useState<"gallery" | "list">("gallery");
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<LibraryEntry | null>(null);
  const [sharing, setSharing] = useState<LibraryEntry | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const stored = typeof window === "undefined" ? null : window.localStorage.getItem(VIEW_KEY);
    if (stored === "list" || stored === "gallery") setView(stored);
  }, []);

  const switchView = (next: "gallery" | "list") => {
    setView(next);
    if (typeof window !== "undefined") window.localStorage.setItem(VIEW_KEY, next);
  };

  const load = useCallback(async () => {
    if (!userId) return;
    const { data, error } = await supabase
      .from("module_library")
      .select("*")
      .eq("user_id", userId)
      .order("updated_at", { ascending: false });
    if (error) {
      toast.error(error.message);
      return;
    }
    setEntries((data ?? []).map((row) => rowToEntry(row as Record<string, unknown>)));
    try {
      const rows = await listSharedEntries();
      setShared(
        (rows ?? []).map((row) => ({
          ...rowToEntry(row as unknown as Record<string, unknown>),
          ownerEmail: (row as { owner_email?: string }).owner_email ?? "",
        })),
      );
    } catch {
      setShared([]);
    }
  }, [userId]);

  useEffect(() => {
    if (open) void load();
    else {
      setEditing(null);
      setSharing(null);
    }
  }, [open, load]);

  const save = async () => {
    if (!userId) return;
    const captured = captureSelection();
    if (!captured) {
      toast.error(l("Erst ein Modul oder mehrere Module auswählen"));
      return;
    }
    setBusy(true);
    const { error } = await supabase.from("module_library").insert({
      user_id: userId,
      title: captured.title,
      description: `${captured.payload.nodes.length} Module`,
      scope: captured.scope,
      payload: captured.payload as never,
    } as never);
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(l("In der Bibliothek gespeichert"));
    void load();
  };

  const update = async (entry: LibraryEntry, patch: Record<string, unknown>) => {
    const { error } = await supabase.from("module_library").update(patch as never).eq("id", entry.id);
    if (error) {
      toast.error(error.message);
      return false;
    }
    await load();
    return true;
  };

  const duplicate = async (entry: LibraryEntry) => {
    if (!userId) return;
    const { error } = await supabase.from("module_library").insert({
      user_id: userId,
      title: `${entry.title} (Kopie)`,
      description: entry.description,
      tags: entry.tags,
      scope: entry.scope,
      payload: entry.payload as never,
    } as never);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(l("Kopie angelegt"));
    void load();
  };

  const remove = async (entry: LibraryEntry) => {
    if (!window.confirm(`„${entry.title}" wirklich löschen?`)) return;
    const { error } = await supabase.from("module_library").delete().eq("id", entry.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    setEntries((current) => current.filter((item) => item.id !== entry.id));
  };

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const match = (entry: LibraryEntry) =>
      !needle ||
      entry.title.toLowerCase().includes(needle) ||
      entry.description.toLowerCase().includes(needle) ||
      entry.tags.some((tag) => tag.toLowerCase().includes(needle));
    return { own: entries.filter(match), shared: shared.filter(match) };
  }, [entries, shared, query]);

  const insert = (entry: LibraryEntry, mode: "empty" | "full") => {
    onOpenChange(false);
    void onInsert(entry, mode);
  };

  const renderEntry = (entry: LibraryEntry, own: boolean) =>
    view === "gallery" ? (
      <div
        key={entry.id}
        className="flex flex-col gap-3 rounded-lg border border-border/70 bg-card p-3 shadow-[var(--shadow-card)] transition-shadow hover:shadow-[var(--shadow-float)]"
      >
        <LibraryPreview payload={entry.payload} className="h-28" />
        <div className="min-h-12">
          <div className="flex items-start gap-2">
            <p className="flex-1 font-display text-sm font-semibold">{entry.title}</p>
            {own ? (
              <EntryActions
                entry={entry}
                onEdit={() => setEditing(entry)}
                onDuplicate={() => void duplicate(entry)}
                onShare={() => setSharing(entry)}
                onDelete={() => void remove(entry)}
              />
            ) : null}
          </div>
          <p className="text-xs text-muted-foreground">
            {entry.description || (own ? "Eigenes Modul" : `Geteilt von ${entry.ownerEmail ?? ""}`)}
          </p>
          <Meta entry={entry} />
        </div>
        <div className="flex gap-2">
          <Button size="sm" className="flex-1 rounded-full" onClick={() => insert(entry, "full")}>
             {l("Mit Inhalten")}
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="rounded-full"
            onClick={() => insert(entry, "empty")}
          >
             {l("Leer")}
          </Button>
        </div>
      </div>
    ) : (
      <div
        key={entry.id}
        className="flex items-center gap-3 rounded-lg border border-border/70 bg-card p-2.5"
      >
        <LibraryPreview payload={entry.payload} className="h-14 w-24 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="truncate font-display text-sm font-semibold">{entry.title}</p>
          <p className="truncate text-xs text-muted-foreground">
            {entry.description || (own ? "Eigenes Modul" : `Geteilt von ${entry.ownerEmail ?? ""}`)}
          </p>
          <Meta entry={entry} />
        </div>
        <Button size="sm" className="rounded-full" onClick={() => insert(entry, "full")}>
           {l("Mit Inhalten")}
        </Button>
        <Button size="sm" variant="outline" className="rounded-full" onClick={() => insert(entry, "empty")}>
           {l("Leer")}
        </Button>
        {own ? (
          <EntryActions
            entry={entry}
            onEdit={() => setEditing(entry)}
            onDuplicate={() => void duplicate(entry)}
            onShare={() => setSharing(entry)}
            onDelete={() => void remove(entry)}
          />
        ) : null}
      </div>
    );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl">{l("Bibliothek")}</DialogTitle>
          <DialogDescription>
            {l("Module und ganze Modulgruppen ablegen und jederzeit wieder einfügen – leer oder mit Inhalten.")}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-center gap-2">
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={l("Suchen nach Name, Beschreibung, Schlagwort")}
            className="h-9 max-w-xs rounded-xl"
          />
          <Button size="sm" className="rounded-full" disabled={busy} onClick={() => void save()}>
             {l("Auswahl speichern")}
          </Button>
          <div className="ml-auto flex items-center gap-1 rounded-full border border-border/70 p-0.5">
            <Button
              size="icon"
              variant="ghost"
              aria-label="Galerie"
              aria-pressed={view === "gallery"}
              className={cn("size-8 rounded-full", view === "gallery" && "bg-accent text-accent-foreground")}
              onClick={() => switchView("gallery")}
            >
              <LayoutGrid className="size-4" />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              aria-label="Liste"
              aria-pressed={view === "list"}
              className={cn("size-8 rounded-full", view === "list" && "bg-accent text-accent-foreground")}
              onClick={() => switchView("list")}
            >
              <ListIcon className="size-4" />
            </Button>
          </div>
        </div>

        {editing ? (
          <EditForm
            key={editing.id}
            entry={editing}
            captureSelection={captureSelection}
            onCancel={() => setEditing(null)}
            onSave={async (patch) => {
              const ok = await update(editing, patch);
              if (ok) {
                setEditing(null);
                toast.success(l("Eintrag aktualisiert"));
              }
            }}
          />
        ) : null}

        {sharing ? (
          <ShareBox
            key={sharing.id}
            entry={sharing}
            onClose={() => setSharing(null)}
            onToggleLink={async (next) => {
              await update(sharing, { is_public: next });
              setSharing({ ...sharing, isPublic: next });
            }}
          />
        ) : null}

        <Tabs defaultValue={onInsertModule ? "catalog" : "own"}>
          <TabsList>
            {onInsertModule ? <TabsTrigger value="catalog">{l("Module")}</TabsTrigger> : null}
            <TabsTrigger value="own">{l("Eigene")} ({entries.length})</TabsTrigger>
            <TabsTrigger value="shared">{l("Mit mir geteilt")} ({shared.length})</TabsTrigger>
          </TabsList>

          <TabsContent value="own" className="mt-4">
            {filtered.own.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                 {l("Noch nichts abgelegt. Modul auswählen und „Auswahl speichern“ klicken – oder auf dem Board per Rechtsklick „In Bibliothek speichern“.")}
              </p>
            ) : (
              <div className={view === "gallery" ? "grid gap-3 sm:grid-cols-3" : "space-y-2"}>
                {filtered.own.map((entry) => renderEntry(entry, true))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="shared" className="mt-4">
            {filtered.shared.length === 0 ? (
              <p className="text-sm text-muted-foreground">{l("Bisher hat niemand etwas mit dir geteilt.")}</p>
            ) : (
              <div className={view === "gallery" ? "grid gap-3 sm:grid-cols-3" : "space-y-2"}>
                {filtered.shared.map((entry) => renderEntry(entry, false))}
              </div>
            )}
          </TabsContent>

          {onInsertModule ? (
            <TabsContent value="catalog" className="mt-4">
              <CatalogList
                query={query}
                onPick={async (name) => {
                  await onInsertModule(name);
                  onOpenChange(false);
                }}
              />
            </TabsContent>
          ) : null}
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

function EditForm({
  entry,
  captureSelection,
  onSave,
  onCancel,
}: {
  entry: LibraryEntry;
  captureSelection: () => CapturedSelection | null;
  onSave: (patch: Record<string, unknown>) => Promise<void>;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState(entry.title);
  const [description, setDescription] = useState(entry.description);
  const [tags, setTags] = useState(entry.tags.join(", "));
  const [payload, setPayload] = useState(entry.payload);
  const [busy, setBusy] = useState(false);

  return (
    <div className="space-y-3 rounded-lg border border-border/70 bg-muted/30 p-4">
      <div className="grid gap-2 sm:grid-cols-3">
        <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Name" className="h-9 rounded-xl" />
        <Input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Kurze Beschreibung"
          className="h-9 rounded-xl"
        />
        <Input
          value={tags}
          onChange={(e) => setTags(e.target.value)}
          placeholder="Schlagwörter, mit Komma getrennt"
          className="h-9 rounded-xl"
        />
      </div>
      <div className="grid gap-3 sm:grid-cols-[260px_1fr]">
        <LibraryPreview payload={payload} className="h-28" />
        <Button
          size="sm"
          variant="outline"
          className="h-9 w-full rounded-full sm:w-auto sm:self-start"
          onClick={() => {
            const captured = captureSelection();
            if (!captured) {
              toast.error("Erst Module auf der Fläche auswählen");
              return;
            }
            setPayload(captured.payload);
            toast.success("Inhalt aus der Auswahl übernommen");
          }}
        >
          Aus aktueller Auswahl aktualisieren
        </Button>
      </div>
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" className="rounded-full" onClick={onCancel}>
          Abbrechen
        </Button>
        <Button
          size="sm"
          className="rounded-full"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            void onSave({
              title: title.trim() || "Modul",
              description: description.trim(),
              tags: tags
                .split(",")
                .map((tag) => tag.trim())
                .filter(Boolean),
              payload: payload as never,
              scope: payload.nodes.length > 1 ? "group" : "single",
            }).finally(() => setBusy(false));
          }}
        >
          Speichern
        </Button>
      </div>
    </div>
  );
}

function ShareBox({
  entry,
  onClose,
  onToggleLink,
}: {
  entry: LibraryEntry;
  onClose: () => void;
  onToggleLink: (next: boolean) => Promise<void>;
}) {
  const [email, setEmail] = useState("");
  const [people, setPeople] = useState<{ id: string; email: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const link = shareLink(`/library/${entry.shareToken}`);

  const load = useCallback(async () => {
    try {
      setPeople(await listEntryShares({ data: { id: entry.id } }));
    } catch {
      setPeople([]);
    }
  }, [entry.id]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-3 rounded-lg border border-border/70 bg-muted/30 p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="font-display text-sm font-semibold">„{entry.title}" teilen</p>
        <Button size="sm" variant="ghost" className="rounded-full" onClick={onClose}>
          Schließen
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant={entry.isPublic ? "default" : "outline"}
          className="rounded-full"
          onClick={() => void onToggleLink(!entry.isPublic)}
        >
          {entry.isPublic ? "Link ist aktiv" : "Link zum Ansehen erstellen"}
        </Button>
        {entry.isPublic ? (
          <>
            <Input value={link} readOnly className="h-9 max-w-sm rounded-xl" />
            <Button
              size="sm"
              variant="outline"
              className="rounded-full"
              onClick={() => {
                void navigator.clipboard.writeText(link);
                toast.success("Link kopiert");
              }}
            >
              Kopieren
            </Button>
          </>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="E-Mail der Person"
          className="h-9 max-w-xs rounded-xl"
        />
        <Button
          size="sm"
          className="rounded-full"
          disabled={busy || !email.trim()}
          onClick={() => {
            setBusy(true);
            void shareLibraryEntry({ data: { id: entry.id, email: email.trim() } })
              .then(() => {
                setEmail("");
                toast.success("Freigegeben");
                void load();
              })
              .catch((error: unknown) =>
                toast.error(error instanceof Error ? error.message : "Freigabe fehlgeschlagen"),
              )
              .finally(() => setBusy(false));
          }}
        >
          Freigeben
        </Button>
      </div>

      {people.length ? (
        <ul className="space-y-1">
          {people.map((person) => (
            <li key={person.id} className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">{person.email}</span>
              <Button
                size="sm"
                variant="ghost"
                className="rounded-full"
                onClick={() => {
                  void removeEntryShare({ data: { id: entry.id, shareId: person.id } })
                    .then(() => void load())
                    .catch((error: unknown) =>
                      toast.error(error instanceof Error ? error.message : "Fehlgeschlagen"),
                    );
                }}
              >
                Entfernen
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
