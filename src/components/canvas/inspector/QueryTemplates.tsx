/**
 * Abfragevorlagen: bewährte Diagramm-Auswertungen (Auswahl oder SQL) speichern
 * und auf andere Tabellen anwenden. Bedienung bewusst schlank: wenige Symbolknöpfe,
 * Erfassungsformular nur bei Bedarf, Sammelaktionen nur bei Auswahl.
 * Fehlende Spalten werden vor dem Anwenden genannt, nie still ersetzt.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  Check,
  Clock,
  Download,
  MoreHorizontal,
  Pencil,
  Play,
  Plus,
  Search,
  Tag,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import {
  configColumns,
  missingTemplateColumns,
  readChartConfig,
  type ChartConfig,
} from "@/lib/chart-config";
import {
  MAX_IMPORT_BYTES,
  classifyImport,
  exportTemplates,
  parseTemplateImport,
  planUpdates,
  type PortableTemplate,
  type UpdatePlan,
} from "@/lib/query-template-io";

type Row = {
  id: string;
  title: string;
  config: ChartConfig;
  columns: string[];
  category: string;
  tags: string[];
  lastUsed: string | null;
};

type ImportPreview = {
  fileName: string;
  fresh: PortableTemplate[];
  updates: UpdatePlan[];
  identical: number;
  skipped: number;
  mode: "skip" | "update";
  pickedFresh: Set<number>;
  pickedUpdates: Set<string>;
};

type SortMode = "new" | "alpha" | "used";

const SORT_MODES: { id: SortMode; label: string }[] = [
  { id: "new", label: "Neueste" },
  { id: "alpha", label: "A–Z" },
  { id: "used", label: "Zuletzt verwendet" },
];

/** Zeitstempel → „Zuletzt verwendet: heute / gestern / vor 3 Tagen / 12.09.2026“. */
export function formatLastUsed(iso: string | null, now: Date = new Date()): string {
  if (!iso) return "Noch nie verwendet";
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return "Noch nie verwendet";
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((startOfDay(now) - startOfDay(then)) / 86_400_000);
  if (days <= 0) return "Zuletzt verwendet: heute";
  if (days === 1) return "Zuletzt verwendet: gestern";
  if (days < 7) return `Zuletzt verwendet: vor ${days} Tagen`;
  return `Zuletzt verwendet: ${then.toLocaleDateString("de-DE")}`;
}

/** "Umsatz, regional ,umsatz" → ["umsatz", "regional"] */
export function parseTags(input: string): string[] {
  const seen = new Set<string>();
  for (const raw of input.split(/[,;#]/)) {
    const tag = raw.trim().toLowerCase().slice(0, 30);
    if (tag) seen.add(tag);
  }
  return [...seen].slice(0, 20);
}

function IconBtn({
  icon: Icon,
  label,
  active,
  disabled,
  onClick,
}: {
  icon: typeof Plus;
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={`grid h-7 w-7 shrink-0 place-items-center rounded-md border transition-colors max-sm:h-9 max-sm:w-9 disabled:opacity-40 ${
        active ? "border-primary bg-accent/60" : "text-muted-foreground hover:bg-secondary"
      }`}
    >
      <Icon className="h-3.5 w-3.5" />
    </button>
  );
}

export function QueryTemplates({
  config,
  available,
  onApply,
}: {
  config: ChartConfig;
  available: string[];
  onApply: (config: ChartConfig) => void;
}) {
  const [rows, setRows] = useState<Row[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [showTags, setShowTags] = useState(false);
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [tagInput, setTagInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [sort, setSort] = useState<SortMode>("new");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editCategory, setEditCategory] = useState("");
  const [editTags, setEditTags] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [preview, setPreview] = useState<ImportPreview | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from("query_templates")
      .select("id,title,config,columns,category,tags,last_used_at")
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) return;
    setRows(
      (data ?? []).flatMap((r) => {
        const parsed = readChartConfig({ chartConfig: r.config });
        return parsed
          ? [
              {
                id: r.id,
                title: r.title,
                config: parsed,
                columns: r.columns ?? [],
                category: r.category ?? "",
                tags: r.tags ?? [],
                lastUsed: r.last_used_at ?? null,
              },
            ]
          : [];
      }),
    );
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const categories = useMemo(
    () => [...new Set(rows.map((r) => r.category).filter(Boolean))].sort((a, b) => a.localeCompare(b, "de")),
    [rows],
  );
  const allTags = useMemo(
    () => [...new Set(rows.flatMap((r) => r.tags))].sort((a, b) => a.localeCompare(b, "de")),
    [rows],
  );

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = rows.filter(
      (r) =>
        (!activeCategory || r.category === activeCategory) &&
        (!activeTag || r.tags.includes(activeTag)) &&
        (!q ||
          r.title.toLowerCase().includes(q) ||
          r.category.toLowerCase().includes(q) ||
          r.tags.some((t) => t.includes(q))),
    );
    if (sort === "alpha") return [...filtered].sort((a, b) => a.title.localeCompare(b.title, "de"));
    if (sort === "used") return [...filtered].sort((a, b) => (b.lastUsed ?? "").localeCompare(a.lastUsed ?? ""));
    return filtered;
  }, [rows, search, activeCategory, activeTag, sort]);

  const canSave = config.mode === "sql" ? !!config.sql.trim() : !!config.groupBy;
  const currentColumns = useMemo(() => configColumns(config, available), [config, available]);

  const save = async () => {
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) return;
    setBusy(true);
    const { error } = await supabase.from("query_templates").insert({
      user_id: auth.user.id,
      title: name.trim().slice(0, 120) || (config.mode === "sql" ? "SQL-Auswertung" : "Auswertung"),
      config: config as never,
      columns: currentColumns,
      category: category.trim().slice(0, 60),
      tags: parseTags(tagInput),
    });
    setBusy(false);
    if (error) {
      toast.error("Vorlage konnte nicht gespeichert werden.");
      return;
    }
    setName("");
    setCategory("");
    setTagInput("");
    setShowForm(false);
    toast.success("Abfragevorlage gespeichert");
    void load();
  };

  const apply = (row: Row) => {
    const missing = missingTemplateColumns(row.columns, available);
    if (missing.length) {
      toast.error(`Diese Tabelle hat keine Spalte ${missing.join(", ")}. Vorlage nicht angewendet.`);
      return;
    }
    onApply(row.config);
    const now = new Date().toISOString();
    setRows((current) => current.map((r) => (r.id === row.id ? { ...r, lastUsed: now } : r)));
    void supabase.from("query_templates").update({ last_used_at: now }).eq("id", row.id);
    toast.success(`„${row.title}" angewendet`);
  };

  const download = (list: Row[]) => {
    const json = exportTemplates(list);
    const url = URL.createObjectURL(new Blob([json], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `abfragevorlagen-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    toast.success(`${list.length} Vorlage${list.length === 1 ? "" : "n"} exportiert`);
  };

  const toggleSelected = (id: string) =>
    setSelected((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  const togglePickedFresh = (index: number) =>
    setPreview((current) => {
      if (!current) return current;
      const picked = new Set(current.pickedFresh);
      if (!picked.delete(index)) picked.add(index);
      return { ...current, pickedFresh: picked };
    });

  const togglePickedUpdate = (id: string) =>
    setPreview((current) => {
      if (!current) return current;
      const picked = new Set(current.pickedUpdates);
      if (!picked.delete(id)) picked.add(id);
      return { ...current, pickedUpdates: picked };
    });

  /** Liest die Datei und zeigt eine Vorschau — gespeichert wird erst nach Bestätigung. */
  const previewFile = async (file: File) => {
    if (file.size > MAX_IMPORT_BYTES) {
      toast.error("Die Datei ist zu groß (maximal 1 MB).");
      return;
    }
    const parsed = parseTemplateImport(await file.text());
    if (parsed.error) {
      toast.error(parsed.error);
      return;
    }
    if (parsed.templates.length === 0 && parsed.skipped === 0) {
      toast.info("Die Datei enthält keine Vorlagen.");
      return;
    }
    const { fresh, duplicates } = classifyImport(parsed.templates, rows);
    const plans = planUpdates(duplicates, rows);
    const updates = plans.filter((p) => p.note);
    setPreview({
      fileName: file.name.slice(0, 60),
      fresh,
      updates,
      identical: duplicates.length - updates.length,
      skipped: parsed.skipped,
      mode: updates.length ? "update" : "skip",
      pickedFresh: new Set(fresh.map((_, index) => index)),
      pickedUpdates: new Set(updates.map((u) => u.id)),
    });
  };

  const importCount = preview
    ? preview.pickedFresh.size + (preview.mode === "update" ? preview.pickedUpdates.size : 0)
    : 0;

  const confirmImport = async () => {
    if (!preview || importCount === 0) return;
    const fresh = preview.fresh.filter((_, index) => preview.pickedFresh.has(index));
    const updates =
      preview.mode === "update" ? preview.updates.filter((u) => preview.pickedUpdates.has(u.id)) : [];
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) return;
    setBusy(true);
    if (fresh.length) {
      const { error } = await supabase.from("query_templates").insert(
        fresh.map((t) => ({
          user_id: auth.user.id,
          title: t.title,
          config: t.config as never,
          columns: t.columns,
          category: t.category,
          tags: t.tags,
        })),
      );
      if (error) {
        setBusy(false);
        toast.error("Import fehlgeschlagen. Es wurde nichts übernommen.");
        return;
      }
    }
    let failed = 0;
    for (const u of updates) {
      const { error } = await supabase
        .from("query_templates")
        .update({ category: u.category, tags: u.tags, columns: u.columns })
        .eq("id", u.id);
      if (error) failed += 1;
    }
    setBusy(false);
    setPreview(null);
    const parts = [
      fresh.length ? `${fresh.length} neu` : "",
      updates.length - failed ? `${updates.length - failed} aktualisiert` : "",
      preview.skipped ? `${preview.skipped} ungültig übersprungen` : "",
      failed ? `${failed} Aktualisierung${failed === 1 ? "" : "en"} fehlgeschlagen` : "",
    ].filter(Boolean);
    if (failed) toast.error(`Import teilweise: ${parts.join(", ")}`);
    else toast.success(`Import abgeschlossen: ${parts.join(", ")}`);
    void load();
  };

  const startEdit = (row: Row) => {
    setEditingId(row.id);
    setEditTitle(row.title);
    setEditCategory(row.category);
    setEditTags(row.tags.join(", "));
  };

  const saveEdit = async (row: Row) => {
    const title = editTitle.trim().slice(0, 120);
    if (!title) {
      toast.error("Der Name darf nicht leer sein.");
      return;
    }
    const category = editCategory.trim().slice(0, 60);
    const tags = parseTags(editTags);
    const { error } = await supabase.from("query_templates").update({ title, category, tags }).eq("id", row.id);
    if (error) {
      toast.error("Änderungen konnten nicht gespeichert werden.");
      return;
    }
    setRows((current) => current.map((r) => (r.id === row.id ? { ...r, title, category, tags } : r)));
    setEditingId(null);
    toast.success("Vorlage aktualisiert");
  };

  const remove = async (id: string) => {
    const { error } = await supabase.from("query_templates").delete().eq("id", id);
    if (error) {
      toast.error("Löschen fehlgeschlagen.");
      return;
    }
    setRows((current) => current.filter((r) => r.id !== id));
    setSelected((current) => {
      const next = new Set(current);
      next.delete(id);
      return next;
    });
  };

  const chip = (active: boolean) =>
    `rounded-full border px-2 py-0.5 text-[10px] ${
      active ? "border-primary bg-accent/60" : "text-muted-foreground hover:bg-secondary"
    }`;

  return (
    <div className="space-y-2 border-t pt-2">
      <div className="flex items-center gap-1">
        <p className="flex-1 text-[11px] font-semibold uppercase tracking-wide">
          Abfragevorlagen{rows.length ? ` (${rows.length})` : ""}
        </p>
        <IconBtn
          icon={showForm ? X : Plus}
          label={showForm ? "Formular schließen" : "Aktuelle Auswertung als Vorlage speichern"}
          active={showForm}
          onClick={() => setShowForm((v) => !v)}
        />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              title="Import und Export"
              aria-label="Import und Export"
              className="grid h-7 w-7 shrink-0 place-items-center rounded-md border text-muted-foreground hover:bg-secondary max-sm:h-9 max-sm:w-9"
            >
              <MoreHorizontal className="h-3.5 w-3.5" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="text-xs max-sm:text-sm [&_[role=menuitem]]:max-sm:py-2.5">
            <DropdownMenuItem disabled={busy} onSelect={() => fileInput.current?.click()}>
              <Upload className="mr-2 h-3.5 w-3.5" /> Importieren (JSON)
            </DropdownMenuItem>
            <DropdownMenuItem disabled={rows.length === 0} onSelect={() => download(rows)}>
              <Download className="mr-2 h-3.5 w-3.5" /> Alle exportieren (JSON)
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              disabled={visible.length === 0}
              onSelect={() => setSelected(new Set(visible.map((r) => r.id)))}
            >
              <Check className="mr-2 h-3.5 w-3.5" /> Alle angezeigten wählen
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <input
          ref={fileInput}
          type="file"
          accept="application/json,.json"
          className="hidden"
          aria-label="Abfragevorlagen importieren"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) void previewFile(file);
          }}
        />
      </div>

      {showForm && (
        <div className="space-y-1.5 rounded-lg border bg-secondary/30 p-2">
          <p className="text-[11px] font-medium">Neue Vorlage speichern</p>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name der Vorlage" className="h-7 text-xs" />
          <div className="grid grid-cols-2 gap-1">
            <Input
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              placeholder="Kategorie"
              list="query-template-categories"
              className="h-7 text-xs"
            />
            <Input value={tagInput} onChange={(e) => setTagInput(e.target.value)} placeholder="Tags, mit Komma" className="h-7 text-xs" />
          </div>
          <datalist id="query-template-categories">
            {categories.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
          <p className="text-[10px] text-muted-foreground">
            {canSave
              ? `Spalten (automatisch): ${currentColumns.join(", ") || "keine"}`
              : "Wähle zuerst eine Auswertung (Gruppierung oder SQL)."}
          </p>
          <div className="flex justify-end gap-1">
            <Button size="sm" variant="ghost" className="h-6 text-[11px]" onClick={() => setShowForm(false)}>
              Abbrechen
            </Button>
            <Button size="sm" className="h-6 text-[11px]" disabled={!canSave || busy} onClick={() => void save()}>
              Speichern
            </Button>
          </div>
        </div>
      )}

      {preview && (
        <div className="space-y-1.5 rounded-lg border p-2" role="region" aria-label="Import-Vorschau">
          <p className="truncate text-[11px] font-semibold">Import: {preview.fileName}</p>
          <p className="text-[10px] text-muted-foreground">
            {preview.fresh.length} neu · {preview.updates.length + preview.identical} vorhanden
            {preview.identical ? ` (${preview.identical} identisch)` : ""} · {preview.skipped} ungültig
          </p>
          {preview.updates.length > 0 && (
            <div className="space-y-0.5 rounded-md border p-1.5">
              <p className="text-[11px] font-medium">Bei gleichem Namen und gleicher Auswertung</p>
              {(
                [
                  ["skip", "Überspringen"],
                  ["update", "Aktualisieren (Kategorie, Tags ergänzen)"],
                ] as const
              ).map(([id, label]) => (
                <label key={id} className="flex items-center gap-2 text-[11px]">
                  <input
                    type="radio"
                    name="import-mode"
                    checked={preview.mode === id}
                    onChange={() => setPreview({ ...preview, mode: id })}
                  />
                  {label}
                </label>
              ))}
            </div>
          )}
          <ul className="max-h-56 space-y-1 overflow-y-auto">
            {preview.fresh.map((t, index) => (
              <li key={`n${index}`} className="flex items-start gap-2 rounded-md border px-1.5 py-1">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={preview.pickedFresh.has(index)}
                  onChange={() => togglePickedFresh(index)}
                  aria-label={`„${t.title}" importieren`}
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[11px] font-medium">
                    <span className="mr-1 rounded bg-accent/60 px-1 text-[9px] uppercase">Neu</span>
                    {t.title}
                  </p>
                  <p className="truncate text-[10px] text-muted-foreground">
                    {[t.config.mode === "sql" ? "SQL" : "Auswahl", t.category, ...t.tags.map((tag) => `#${tag}`)]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </div>
              </li>
            ))}
            {preview.updates.map((u) => (
              <li
                key={u.id}
                className={`flex items-start gap-2 rounded-md border px-1.5 py-1 ${preview.mode === "skip" ? "opacity-50" : ""}`}
              >
                <input
                  type="checkbox"
                  className="mt-0.5"
                  disabled={preview.mode === "skip"}
                  checked={preview.mode === "update" && preview.pickedUpdates.has(u.id)}
                  onChange={() => togglePickedUpdate(u.id)}
                  aria-label={`„${u.title}" aktualisieren`}
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[11px] font-medium">
                    <span className="mr-1 rounded border px-1 text-[9px] uppercase">
                      {preview.mode === "update" ? "Aktualisieren" : "Übersprungen"}
                    </span>
                    {u.title}
                  </p>
                  <p className="text-[10px] text-primary">{u.note}</p>
                </div>
              </li>
            ))}
          </ul>
          <div className="flex gap-1">
            <Button
              size="sm"
              className="h-7 flex-1 gap-1 text-[11px]"
              disabled={busy || importCount === 0}
              onClick={() => void confirmImport()}
            >
              <Check className="h-3.5 w-3.5" /> {importCount} übernehmen
            </Button>
            <Button size="sm" variant="ghost" className="h-7 text-[11px]" onClick={() => setPreview(null)}>
              Abbrechen
            </Button>
          </div>
        </div>
      )}

      {rows.length === 0 ? (
        <p className="text-[11px] text-muted-foreground">
          Noch keine gespeicherten Auswertungen. Mit + speicherst du die aktuelle als Vorlage.
        </p>
      ) : (
        <>
          <div className="flex gap-1">
            <div className="flex h-7 min-w-0 flex-1 items-center gap-1 rounded-md border px-2 max-sm:h-9">
              <Search className="h-3 w-3 shrink-0 text-muted-foreground" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Vorlagen suchen"
                aria-label="Vorlagen suchen"
                className="w-full min-w-0 bg-transparent text-xs outline-none max-sm:text-base"
              />
            </div>
            <Select value={sort} onValueChange={(v) => setSort(v as SortMode)}>
              <SelectTrigger className="h-7 w-[7.5rem] shrink-0 text-xs max-sm:h-9 sm:w-[8.5rem]" aria-label="Sortierung">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SORT_MODES.map((m) => (
                  <SelectItem key={m.id} value={m.id} className="text-xs">
                    {m.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {allTags.length > 0 && (
              <IconBtn
                icon={Tag}
                label="Nach Tag filtern"
                active={showTags || !!activeTag}
                onClick={() => setShowTags((v) => !v)}
              />
            )}
          </div>
          {categories.length > 0 && (
            <div className="flex flex-wrap gap-1">
              <button className={chip(!activeCategory)} onClick={() => setActiveCategory(null)}>
                Alle
              </button>
              {categories.map((c) => (
                <button key={c} className={chip(activeCategory === c)} onClick={() => setActiveCategory(activeCategory === c ? null : c)}>
                  {c}
                </button>
              ))}
            </div>
          )}
          {(showTags || activeTag) && allTags.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {allTags.map((t) => (
                <button key={t} className={chip(activeTag === t)} onClick={() => setActiveTag(activeTag === t ? null : t)}>
                  #{t}
                </button>
              ))}
            </div>
          )}
          {selected.size > 0 && (
            <div className="flex items-center gap-2 rounded-lg border border-primary/40 bg-accent/40 px-2 py-1 text-[11px]">
              <span className="flex-1">{selected.size} gewählt</span>
              <button
                className="flex items-center gap-1 rounded-md border bg-background px-2 py-0.5 hover:bg-secondary"
                onClick={() => download(rows.filter((r) => selected.has(r.id)))}
              >
                <Download className="h-3 w-3" /> Export ({selected.size})
              </button>
              <IconBtn icon={X} label="Auswahl aufheben" onClick={() => setSelected(new Set())} />
            </div>
          )}
          {visible.length === 0 ? (
            <p className="text-[11px] text-muted-foreground">Keine Vorlage passt zum Filter.</p>
          ) : (
            <ul className="space-y-1">
              {visible.map((row) => {
                const missing = missingTemplateColumns(row.columns, available);
                return (
                  <li key={row.id} className="rounded-lg border px-2 py-1.5 text-[11px]">
                    <div className="flex items-start gap-2">
                      <input
                        type="checkbox"
                        className="mt-1"
                        checked={selected.has(row.id)}
                        onChange={() => toggleSelected(row.id)}
                        aria-label={`„${row.title}" zum Export auswählen`}
                      />
                      <div className="min-w-0 flex-1" title={row.columns.join(", ")}>
                        <p className="truncate font-medium">
                          {row.title}
                          <span className="ml-1 font-normal text-muted-foreground">
                            ({row.config.mode === "sql" ? "SQL" : "Auswahl"})
                          </span>
                        </p>
                        {row.category || row.tags.length ? (
                          <p className="truncate text-[10px] text-muted-foreground">
                            {[row.category, ...row.tags.map((t) => `#${t}`)].filter(Boolean).join(" · ")}
                          </p>
                        ) : null}
                        {missing.length ? (
                          <p className="text-[10px] text-destructive">Fehlt: {missing.join(", ")}</p>
                        ) : (
                          <p
                            className="flex items-center gap-1 truncate text-[10px] text-muted-foreground"
                            title={row.lastUsed ? new Date(row.lastUsed).toLocaleString("de-DE") : undefined}
                          >
                            <Clock className="h-3 w-3 shrink-0" />
                            {formatLastUsed(row.lastUsed).replace("Zuletzt verwendet: ", "")}
                          </p>
                        )}
                      </div>
                      <IconBtn
                        icon={Play}
                        label={missing.length ? "Nicht anwendbar: Spalten fehlen" : "Auf diese Tabelle anwenden"}
                        disabled={missing.length > 0}
                        onClick={() => apply(row)}
                      />
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button
                            type="button"
                            aria-label={`Weitere Aktionen für „${row.title}"`}
                            title="Mehr"
                            className="grid h-7 w-7 shrink-0 place-items-center rounded-md border text-muted-foreground hover:bg-secondary max-sm:h-9 max-sm:w-9"
                          >
                            <MoreHorizontal className="h-3.5 w-3.5" />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="text-xs max-sm:text-sm [&_[role=menuitem]]:max-sm:py-2.5">
                          <DropdownMenuItem onSelect={() => (editingId === row.id ? setEditingId(null) : startEdit(row))}>
                            <Pencil className="mr-2 h-3.5 w-3.5" /> Bearbeiten
                          </DropdownMenuItem>
                          <DropdownMenuItem className="text-destructive" onSelect={() => void remove(row.id)}>
                            <Trash2 className="mr-2 h-3.5 w-3.5" /> Löschen
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                    {editingId === row.id && (
                      <div className="mt-1.5 space-y-1 rounded-md border bg-secondary/30 p-1.5">
                        <Input
                          value={editTitle}
                          onChange={(e) => setEditTitle(e.target.value)}
                          placeholder="Name der Vorlage"
                          maxLength={120}
                          className="h-7 text-xs"
                        />
                        <Input
                          value={editCategory}
                          onChange={(e) => setEditCategory(e.target.value)}
                          placeholder="Kategorie"
                          list="query-template-categories"
                          className="h-7 text-xs"
                        />
                        <Input value={editTags} onChange={(e) => setEditTags(e.target.value)} placeholder="Tags, mit Komma" className="h-7 text-xs" />
                        <div className="flex justify-end gap-1">
                          <Button size="sm" variant="ghost" className="h-6 text-[11px]" onClick={() => setEditingId(null)}>
                            Abbrechen
                          </Button>
                          <Button size="sm" className="h-6 text-[11px]" onClick={() => void saveEdit(row)}>
                            Speichern
                          </Button>
                        </div>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
