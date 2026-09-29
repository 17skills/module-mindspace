/**
 * Abfragevorlagen: bewährte Diagramm-Auswertungen (Auswahl oder SQL) speichern
 * und auf andere Tabellen anwenden. Kategorie und Tags helfen beim Wiederfinden.
 * Fehlende Spalten werden vor dem Anwenden genannt, nie still ersetzt.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
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
  exportTemplates,
  parseTemplateImport,
  templateKey,
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
    if (sort === "alpha")
      return [...filtered].sort((a, b) => a.title.localeCompare(b.title, "de"));
    if (sort === "used")
      return [...filtered].sort((a, b) => (b.lastUsed ?? "").localeCompare(a.lastUsed ?? ""));
    return filtered;
  }, [rows, search, activeCategory, activeTag, sort]);

  const canSave = config.mode === "sql" ? !!config.sql.trim() : !!config.groupBy;

  const save = async () => {
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) return;
    setBusy(true);
    const { error } = await supabase.from("query_templates").insert({
      user_id: auth.user.id,
      title: name.trim().slice(0, 120) || (config.mode === "sql" ? "SQL-Auswertung" : "Auswertung"),
      config: config as never,
      columns: configColumns(config, available),
      category: category.trim().slice(0, 60),
      tags: parseTags(tagInput),
    });
    setBusy(false);
    if (error) {
      toast.error("Vorlage konnte nicht gespeichert werden.");
      return;
    }
    setName("");
    setTagInput("");
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

  const exportAll = () => {
    const json = exportTemplates(rows);
    const url = URL.createObjectURL(new Blob([json], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `abfragevorlagen-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    toast.success(`${rows.length} Vorlage${rows.length === 1 ? "" : "n"} exportiert`);
  };

  const importFile = async (file: File) => {
    if (file.size > MAX_IMPORT_BYTES) {
      toast.error("Die Datei ist zu groß (maximal 1 MB).");
      return;
    }
    const parsed = parseTemplateImport(await file.text());
    if (parsed.error) {
      toast.error(parsed.error);
      return;
    }
    const existing = new Set(rows.map(templateKey));
    const fresh = parsed.templates.filter((t) => {
      const key = templateKey(t);
      if (existing.has(key)) return false;
      existing.add(key);
      return true;
    });
    const duplicates = parsed.templates.length - fresh.length;
    if (fresh.length === 0) {
      toast.info(
        parsed.skipped || duplicates
          ? `Nichts importiert: ${duplicates} bereits vorhanden, ${parsed.skipped} ungültig.`
          : "Die Datei enthält keine Vorlagen.",
      );
      return;
    }
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) return;
    setBusy(true);
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
    setBusy(false);
    if (error) {
      toast.error("Import fehlgeschlagen. Es wurde nichts übernommen.");
      return;
    }
    const notes = [
      duplicates ? `${duplicates} bereits vorhanden` : "",
      parsed.skipped ? `${parsed.skipped} ungültig übersprungen` : "",
    ].filter(Boolean);
    toast.success(
      `${fresh.length} Vorlage${fresh.length === 1 ? "" : "n"} importiert${notes.length ? ` (${notes.join(", ")})` : ""}`,
    );
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
    const { error } = await supabase
      .from("query_templates")
      .update({ title, category, tags })
      .eq("id", row.id);
    if (error) {
      toast.error("Änderungen konnten nicht gespeichert werden.");
      return;
    }
    setRows((current) =>
      current.map((r) => (r.id === row.id ? { ...r, title, category, tags } : r)),
    );
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
  };

  const chip = (active: boolean) =>
    `rounded-full border px-2 py-0.5 text-[10px] ${
      active ? "border-primary bg-accent/60" : "text-muted-foreground hover:bg-secondary"
    }`;

  return (
    <div className="space-y-2 border-t pt-2">
      <p className="text-[11px] font-medium">Abfragevorlagen</p>

      <div className="space-y-1">
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name der Vorlage" className="h-7 text-xs" />
        <div className="grid grid-cols-2 gap-1">
          <Input
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            placeholder="Kategorie"
            list="query-template-categories"
            className="h-7 text-xs"
          />
          <Input
            value={tagInput}
            onChange={(e) => setTagInput(e.target.value)}
            placeholder="Tags, mit Komma"
            className="h-7 text-xs"
          />
        </div>
        <datalist id="query-template-categories">
          {categories.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
        <Button size="sm" className="h-7 w-full text-xs" disabled={!canSave || busy} onClick={() => void save()}>
          Aktuelle Auswertung speichern
        </Button>
        <div className="flex gap-1">
          <Button
            size="sm"
            variant="outline"
            className="h-7 flex-1 text-xs"
            disabled={rows.length === 0}
            onClick={exportAll}
          >
            Alle exportieren (JSON)
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-7 flex-1 text-xs"
            disabled={busy}
            onClick={() => fileInput.current?.click()}
          >
            Importieren (JSON)
          </Button>
          <input
            ref={fileInput}
            type="file"
            accept="application/json,.json"
            className="hidden"
            aria-label="Abfragevorlagen importieren"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) void importFile(file);
            }}
          />
        </div>
      </div>


      {rows.length === 0 ? (
        <p className="text-[11px] text-muted-foreground">Noch keine gespeicherten Auswertungen.</p>
      ) : (
        <>
          <div className="flex gap-1">
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Vorlagen suchen" className="h-7 flex-1 text-xs" />
            <Select value={sort} onValueChange={(v) => setSort(v as SortMode)}>
              <SelectTrigger className="h-7 w-[8.5rem] text-xs" aria-label="Sortierung">
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
          {allTags.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {allTags.map((t) => (
                <button key={t} className={chip(activeTag === t)} onClick={() => setActiveTag(activeTag === t ? null : t)}>
                  #{t}
                </button>
              ))}
            </div>
          )}
          {visible.length === 0 ? (
            <p className="text-[11px] text-muted-foreground">Keine Vorlage passt zum Filter.</p>
          ) : (
            <ul className="space-y-1">
              {visible.map((row) => {
                const missing = missingTemplateColumns(row.columns, available);
                return (
                  <li key={row.id} className="text-[11px]">
                    <div className="flex items-start gap-1">
                      <div className="min-w-0 flex-1" title={row.columns.join(", ")}>
                        <p className="truncate">
                          {row.title}
                          <span className="ml-1 text-muted-foreground">
                            ({row.config.mode === "sql" ? "SQL" : "Auswahl"})
                          </span>
                        </p>
                        <p className="truncate text-[10px] text-muted-foreground">
                          {[row.category, ...row.tags.map((t) => `#${t}`)].filter(Boolean).join(" · ")}
                        </p>
                        <p
                          className="truncate text-[10px] text-muted-foreground"
                          title={row.lastUsed ? new Date(row.lastUsed).toLocaleString("de-DE") : undefined}
                        >
                          {formatLastUsed(row.lastUsed)}
                        </p>
                        {missing.length ? <p className="text-[10px] text-destructive">fehlt: {missing.join(", ")}</p> : null}
                      </div>
                      <button
                        className="rounded-full border px-2 py-0.5 hover:bg-secondary disabled:opacity-40"
                        disabled={missing.length > 0}
                        onClick={() => apply(row)}
                      >
                        Anwenden
                      </button>
                      <button
                        className="px-1 text-muted-foreground hover:text-foreground"
                        aria-label="Name, Kategorie und Tags bearbeiten"
                        title="Name, Kategorie und Tags bearbeiten"
                        onClick={() => (editingId === row.id ? setEditingId(null) : startEdit(row))}
                      >
                        ✎
                      </button>
                      <button
                        className="px-1 text-muted-foreground hover:text-foreground"
                        aria-label="Vorlage löschen"
                        onClick={() => void remove(row.id)}
                      >
                        ×
                      </button>
                    </div>
                    {editingId === row.id && (
                      <div className="mt-1 space-y-1 rounded border p-1.5">
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
                        <Input
                          value={editTags}
                          onChange={(e) => setEditTags(e.target.value)}
                          placeholder="Tags, mit Komma"
                          className="h-7 text-xs"
                        />
                        <div className="flex gap-1">
                          <Button size="sm" className="h-6 flex-1 text-[11px]" onClick={() => void saveEdit(row)}>
                            Speichern
                          </Button>
                          <Button size="sm" variant="ghost" className="h-6 text-[11px]" onClick={() => setEditingId(null)}>
                            Abbrechen
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
