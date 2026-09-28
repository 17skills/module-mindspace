/**
 * Abfragevorlagen: bewährte Diagramm-Auswertungen (Auswahl oder SQL) speichern
 * und auf andere Tabellen anwenden. Kategorie und Tags helfen beim Wiederfinden.
 * Fehlende Spalten werden vor dem Anwenden genannt, nie still ersetzt.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import {
  configColumns,
  missingTemplateColumns,
  readChartConfig,
  type ChartConfig,
} from "@/lib/chart-config";

type Row = {
  id: string;
  title: string;
  config: ChartConfig;
  columns: string[];
  category: string;
  tags: string[];
};

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

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from("query_templates")
      .select("id,title,config,columns,category,tags")
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
    return rows.filter(
      (r) =>
        (!activeCategory || r.category === activeCategory) &&
        (!activeTag || r.tags.includes(activeTag)) &&
        (!q ||
          r.title.toLowerCase().includes(q) ||
          r.category.toLowerCase().includes(q) ||
          r.tags.some((t) => t.includes(q))),
    );
  }, [rows, search, activeCategory, activeTag]);

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
    toast.success(`„${row.title}" angewendet`);
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
      </div>

      {rows.length === 0 ? (
        <p className="text-[11px] text-muted-foreground">Noch keine gespeicherten Auswertungen.</p>
      ) : (
        <>
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Vorlagen suchen" className="h-7 text-xs" />
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
                  <li key={row.id} className="flex items-start gap-1 text-[11px]">
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
                      aria-label="Vorlage löschen"
                      onClick={() => void remove(row.id)}
                    >
                      ×
                    </button>
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
