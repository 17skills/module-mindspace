/**
 * Diagramm-Daten: der Nutzer bestimmt, was gezeigt wird.
 *
 * Ohne verbundene Datenablage werden die Spalten der eigenen kleinen Tabelle
 * gewählt. Mit verbundener Tabelle gibt es zwei Ebenen: Auswahlfelder für den
 * Alltag und einen Experten-Modus mit freier Leseabfrage.
 */
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useBoard, type NodeRecord } from "@/components/canvas/board-context";
import { readDatasetRef, validateReadOnlySql } from "@/lib/datasets";
import { readSource } from "@/lib/source-node";
import {
  CHART_FUNCTIONS,
  CHART_LIMITS,
  CHART_SORTS,
  EMPTY_CHART_CONFIG,
  chartConfigToSql,
  readChartConfig,
  suggestChartConfig,
  type ChartConfig,
} from "@/lib/chart-config";
import type { ColumnSpec } from "@/lib/runtime/source-protocol";
import { QueryTemplates } from "./QueryTemplates";

export function ChartDataSection({
  record,
  columns,
  onSaveMeta,
}: {
  record: NodeRecord;
  columns: string[];
  onSaveMeta: (extra: Record<string, unknown>) => void;
}) {
  const { updateNode, allNodes } = useBoard();
  const labelColumn = Number((record.metadata as Record<string, unknown>)?.["labelColumn"] ?? 0);
  const valueColumn = Number((record.metadata as Record<string, unknown>)?.["valueColumn"] ?? 1);

  /** Spalten aller abgelegten Tabellen dieses Scopes. */
  const datasetColumns = useMemo<ColumnSpec[]>(() => {
    const seen = new Map<string, ColumnSpec>();
    for (const node of allNodes()) {
      const stored = readSource(node);
      if (!readDatasetRef(stored?.envelope)) continue;
      for (const column of stored?.envelope.facets.dataset?.columns ?? []) {
        if (!seen.has(column.key)) seen.set(column.key, column);
      }
    }
    return [...seen.values()];
  }, [allNodes]);

  const stored = readChartConfig(record.metadata);
  const config = stored ?? suggestChartConfig(datasetColumns) ?? EMPTY_CHART_CONFIG;
  const [sql, setSql] = useState(() => stored?.sql || chartConfigToSql(config));
  const [sqlProblem, setSqlProblem] = useState<string | null>(null);

  const save = (patch: Partial<ChartConfig>) =>
    updateNode(record.id, {
      metadata: { ...(record.metadata ?? {}), chartConfig: { ...config, ...patch } },
    });

  if (!datasetColumns.length) {
    return (
      <div className="grid grid-cols-2 gap-2">
        <Select
          value={String(labelColumn)}
          onValueChange={(value) => onSaveMeta({ labelColumn: Number(value) })}
        >
          <SelectTrigger className="h-8 text-xs">
            <SelectValue placeholder="Beschriftung" />
          </SelectTrigger>
          <SelectContent>
            {columns.map((column, index) => (
              <SelectItem key={index} value={String(index)} className="text-xs">
                {column || `Spalte ${index + 1}`}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={String(valueColumn)}
          onValueChange={(value) => onSaveMeta({ valueColumn: Number(value) })}
        >
          <SelectTrigger className="h-8 text-xs">
            <SelectValue placeholder="Wert" />
          </SelectTrigger>
          <SelectContent>
            {columns.map((column, index) => (
              <SelectItem key={index} value={String(index)} className="text-xs">
                {column || `Spalte ${index + 1}`}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    );
  }

  const texts = datasetColumns.filter((c) => c.type !== "number");
  const numbers = datasetColumns.filter((c) => c.type === "number");

  return (
    <div className="space-y-2 rounded border p-2">
      <div className="flex gap-1">
        {(["visual", "sql"] as const).map((mode) => (
          <button
            key={mode}
            onClick={() => save({ mode })}
            className={`rounded-full border px-2.5 py-0.5 text-[11px] ${
              config.mode === mode
                ? "border-primary bg-accent/60"
                : "text-muted-foreground hover:bg-secondary"
            }`}
          >
            {mode === "visual" ? "Auswahl" : "SQL / Experte"}
          </button>
        ))}
      </div>

      {config.mode === "visual" ? (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <Select
              value={config.groupBy ?? ""}
              onValueChange={(value) => save({ groupBy: value })}
            >
              <SelectTrigger className="h-8 text-xs">
                <SelectValue placeholder="Kategorie" />
              </SelectTrigger>
              <SelectContent>
                {(texts.length ? texts : datasetColumns).map((column) => (
                  <SelectItem key={column.key} value={column.key} className="text-xs">
                    {column.label || column.key}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={config.measure ?? "__count"}
              onValueChange={(value) =>
                save(
                  value === "__count"
                    ? { measure: null, fn: "count" }
                    : { measure: value, fn: config.fn === "count" ? "sum" : config.fn },
                )
              }
            >
              <SelectTrigger className="h-8 text-xs">
                <SelectValue placeholder="Messwert" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__count" className="text-xs">
                  Anzahl Zeilen
                </SelectItem>
                {numbers.map((column) => (
                  <SelectItem key={column.key} value={column.key} className="text-xs">
                    {column.label || column.key}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <Select
              value={config.fn}
              onValueChange={(value) => save({ fn: value as ChartConfig["fn"] })}
            >
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CHART_FUNCTIONS.map((option) => (
                  <SelectItem key={option.id} value={option.id} className="text-xs">
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={config.sort}
              onValueChange={(value) => save({ sort: value as ChartConfig["sort"] })}
            >
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CHART_SORTS.map((option) => (
                  <SelectItem key={option.id} value={option.id} className="text-xs">
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={String(config.limit)} onValueChange={(v) => save({ limit: Number(v) })}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CHART_LIMITS.map((option) => (
                  <SelectItem key={option} value={String(option)} className="text-xs">
                    Top {option}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <button
            className="text-[11px] text-muted-foreground underline hover:text-foreground"
            onClick={() => {
              setSql(chartConfigToSql(config));
              save({ mode: "sql", sql: chartConfigToSql(config) });
            }}
          >
            Als Abfrage bearbeiten
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-[11px] text-muted-foreground">
            Nur Leseabfragen. Die Tabelle heißt <code>data</code>, verfügbare Spalten:{" "}
            {datasetColumns.map((c) => c.key).join(", ")}. Zwei Ergebnisspalten erwartet:{" "}
            <code>name</code> und <code>value</code>.
          </p>
          <textarea
            value={sql}
            onChange={(e) => setSql(e.target.value)}
            spellCheck={false}
            rows={7}
            className="w-full rounded border bg-secondary/20 p-2 font-mono text-[11px] outline-none"
          />
          {sqlProblem && <p className="text-[11px] text-destructive">{sqlProblem}</p>}
          <Button
            size="sm"
            className="h-7 text-xs"
            onClick={() => {
              const problem = validateReadOnlySql(sql);
              setSqlProblem(problem);
              if (!problem) save({ mode: "sql", sql });
            }}
          >
            Abfrage ausführen
          </Button>
        </div>
      )}
      <QueryTemplates
        config={config}
        available={datasetColumns.map((c) => c.key)}
        onApply={(next) => {
          setSql(next.sql || chartConfigToSql(next));
          setSqlProblem(null);
          updateNode(record.id, {
            metadata: { ...(record.metadata ?? {}), chartConfig: next },
          });
        }}
      />
    </div>
  );
}
