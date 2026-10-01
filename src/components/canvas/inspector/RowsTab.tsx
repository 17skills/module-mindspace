/**
 * Tabellen-Prüfer für abgelegte Datensätze.
 *
 * Gelesen wird immer seitenweise aus der Datenbank (`dataset_query_rows`):
 * 50 Zeilen je Seite, gefiltert wird in Postgres. Der Browser hält nie die
 * ganze Tabelle.
 */
import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { queryDataset } from "@/lib/datasets.functions";
import { readDatasetRef, type FilterOp } from "@/lib/datasets";
import { readSource } from "@/lib/source-node";
import type { NodeRecord } from "@/components/canvas/board-context";
import { useTranslation } from "@/lib/i18n";

const PAGE_SIZE = 50;

const OPS: { id: FilterOp; label: string }[] = [
  { id: "contains", label: "enthält" },
  { id: "eq", label: "ist gleich" },
  { id: "neq", label: "ist ungleich" },
  { id: "gt", label: "größer als" },
  { id: "lt", label: "kleiner als" },
  { id: "filled", label: "ist gefüllt" },
];

type Row = { index: number; values: Record<string, unknown> };

function cell(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export function RowsTab({ record }: { record: NodeRecord }) {
  const { l } = useTranslation();
  const stored = readSource(record);
  const ref = readDatasetRef(stored?.envelope);
  const run = useServerFn(queryDataset);

  const columns = useMemo(
    () => (stored?.envelope.facets.dataset?.columns ?? []).map((column) => column.key),
    [stored],
  );

  const [page, setPage] = useState(0);
  const [column, setColumn] = useState("");
  const [op, setOp] = useState<FilterOp>("contains");
  const [value, setValue] = useState("");
  const [applied, setApplied] = useState<{ column: string; op: FilterOp; value: string } | null>(
    null,
  );
  const [rows, setRows] = useState<Row[]>([]);
  const [matched, setMatched] = useState(0);
  const [total, setTotal] = useState(ref?.rowCount ?? 0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!ref?.datasetId) return;
    let active = true;
    setLoading(true);
    setError(null);
    const filters = applied?.column
      ? [
          {
            column: applied.column,
            op: applied.op,
            ...(applied.op === "filled" ? {} : { value: applied.value }),
          },
        ]
      : [];
    void run({
      data: {
        datasetId: ref.datasetId,
        query: { mode: "rows", filters, limit: PAGE_SIZE, offset: page * PAGE_SIZE },
      },
    })
      .then((answer) => {
        if (!active) return;
        const result = (answer as { result: { rows?: Row[]; matched: number; total: number } })
          .result;
        setRows(result.rows ?? []);
        setMatched(result.matched);
        setTotal(result.total);
      })
      .catch((cause: unknown) => {
        if (!active) return;
        setRows([]);
        setError(cause instanceof Error ? cause.message : l("Zeilen konnten nicht geladen werden."));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ref?.datasetId, page, applied]);

  if (!ref?.datasetId) {
    return (
      <p className="p-4 text-xs text-muted-foreground">
        {l("Dieses Modul hat keine abgelegte Tabelle.")}
      </p>
    );
  }

  const shown = columns.length ? columns : Object.keys(rows[0]?.values ?? {});
  const pages = Math.max(1, Math.ceil(matched / PAGE_SIZE));

  return (
    <div className="flex h-full flex-col">
      <div className="shrink-0 space-y-2 border-b px-3 py-2">
        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={column || "__none"}
            onValueChange={(next) => setColumn(next === "__none" ? "" : next)}
          >
            <SelectTrigger className="h-8 w-36 text-xs">
              <SelectValue placeholder={l("Spalte")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none">{l("Alle Zeilen")}</SelectItem>
              {shown.map((key) => (
                <SelectItem key={key} value={key}>
                  {key}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={op} onValueChange={(next) => setOp(next as FilterOp)}>
            <SelectTrigger className="h-8 w-32 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {OPS.map((item) => (
                <SelectItem key={item.id} value={item.id}>
                  {l(item.label)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {op !== "filled" && (
            <Input
              value={value}
              onChange={(event) => setValue(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== "Enter") return;
                setPage(0);
                setApplied(column ? { column, op, value } : null);
              }}
              placeholder={l("Wert")}
              className="h-8 w-28 text-xs"
            />
          )}
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setPage(0);
              setApplied(column ? { column, op, value } : null);
            }}
          >
            {l("Filtern")}
          </Button>
          {applied && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setColumn("");
                setValue("");
                setApplied(null);
                setPage(0);
              }}
            >
              {l("Zurücksetzen")}
            </Button>
          )}
        </div>
        <p className="text-[11px] text-muted-foreground">
          {applied
            ? `${matched.toLocaleString()} ${l("Treffer")} ${l("von")} ${total.toLocaleString()} ${l("Zeilen")}`
            : `${total.toLocaleString()} ${l("Zeilen")}`}
          {` · ${l("Seite")} ${page + 1} ${l("von")} ${pages}`}
        </p>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {error && <p className="p-3 text-xs text-destructive">{error}</p>}
        {loading && !rows.length && (
          <p className="p-3 text-xs text-muted-foreground">{l("Zeilen werden geladen …")}</p>
        )}
        {!loading && !error && rows.length === 0 && (
          <p className="p-3 text-xs text-muted-foreground">{l("Keine Zeile passt zum Filter.")}</p>
        )}
        {rows.length > 0 && (
          <table className="w-full border-collapse text-[11px]">
            <thead className="sticky top-0 bg-card">
              <tr>
                <th className="border-b px-2 py-1.5 text-left font-medium text-muted-foreground">
                  #
                </th>
                {shown.map((key) => (
                  <th
                    key={key}
                    className="whitespace-nowrap border-b px-2 py-1.5 text-left font-medium"
                  >
                    {key}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.index} className="hover:bg-secondary/50">
                  <td className="border-b px-2 py-1 text-muted-foreground">{row.index + 1}</td>
                  {shown.map((key) => (
                    <td key={key} className="max-w-[14rem] truncate border-b px-2 py-1">
                      {cell(row.values[key])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="flex shrink-0 items-center justify-between gap-2 border-t px-3 py-2">
        <Button
          size="sm"
          variant="outline"
          disabled={page === 0 || loading}
          onClick={() => setPage((prev) => Math.max(0, prev - 1))}
        >
          {l("Zurück")}
        </Button>
        <span className="text-[11px] text-muted-foreground">
          {l("Seite")} {page + 1} / {pages}
        </span>
        <Button
          size="sm"
          variant="outline"
          disabled={page + 1 >= pages || loading}
          onClick={() => setPage((prev) => prev + 1)}
        >
          {l("Weiter")}
        </Button>
      </div>
    </div>
  );
}
