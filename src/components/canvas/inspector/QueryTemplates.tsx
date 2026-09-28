/**
 * Abfragevorlagen: bewährte Diagramm-Auswertungen (Auswahl oder SQL) speichern
 * und auf andere Tabellen anwenden. Fehlende Spalten werden vor dem Anwenden
 * genannt, nie still ersetzt.
 */
import { useCallback, useEffect, useState } from "react";
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

type Row = { id: string; title: string; config: ChartConfig; columns: string[] };

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
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from("query_templates")
      .select("id,title,config,columns")
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) return;
    setRows(
      (data ?? []).flatMap((r) => {
        const parsed = readChartConfig({ chartConfig: r.config });
        return parsed ? [{ id: r.id, title: r.title, config: parsed, columns: r.columns ?? [] }] : [];
      }),
    );
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

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
    });
    setBusy(false);
    if (error) return toast.error("Vorlage konnte nicht gespeichert werden.");
    setName("");
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
    if (error) return toast.error("Löschen fehlgeschlagen.");
    setRows((current) => current.filter((r) => r.id !== id));
  };

  return (
    <div className="space-y-2 border-t pt-2">
      <p className="text-[11px] font-medium">Abfragevorlagen</p>
      <div className="flex gap-1">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Name der Vorlage"
          className="h-7 text-xs"
        />
        <Button size="sm" className="h-7 text-xs" disabled={!canSave || busy} onClick={() => void save()}>
          Speichern
        </Button>
      </div>
      {rows.length === 0 ? (
        <p className="text-[11px] text-muted-foreground">Noch keine gespeicherten Auswertungen.</p>
      ) : (
        <ul className="space-y-1">
          {rows.map((row) => {
            const missing = missingTemplateColumns(row.columns, available);
            return (
              <li key={row.id} className="flex items-center gap-1 text-[11px]">
                <span className="flex-1 truncate" title={row.columns.join(", ")}>
                  {row.title}
                  <span className="ml-1 text-muted-foreground">
                    ({row.config.mode === "sql" ? "SQL" : "Auswahl"})
                  </span>
                  {missing.length ? (
                    <span className="ml-1 text-destructive">fehlt: {missing.join(", ")}</span>
                  ) : null}
                </span>
                <button
                  className="rounded-full border px-2 py-0.5 hover:bg-secondary disabled:opacity-40"
                  disabled={missing.length > 0}
                  onClick={() => apply(row)}
                >
                  Anwenden
                </button>
                <button className="px-1 text-muted-foreground hover:text-foreground" onClick={() => void remove(row.id)}>
                  ×
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
