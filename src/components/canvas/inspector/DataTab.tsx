import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { readStructure, structureText } from "@/lib/structure";
import { ChartDataSection } from "@/components/canvas/inspector/ChartDataSection";
import { useBoard, type NodeRecord } from "@/components/canvas/board-context";
import { useTranslation } from "@/lib/i18n";

const KINDS = [
  { id: "table", label: "Tabelle" },
  { id: "list", label: "Liste" },
  { id: "chart", label: "Diagramm" },
];

const CHART_TYPES = [
  { id: "bar", label: "Balken" },
  { id: "line", label: "Linie" },
  { id: "pie", label: "Kreis" },
];

function TableIconButton({
  label,
  hint,
  symbol,
  destructive = false,
  unavailable = false,
  onClick,
}: {
  label: string;
  hint: string;
  symbol: "▲" | "▼" | "✕";
  destructive?: boolean;
  unavailable?: boolean;
  onClick: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          aria-label={label}
          aria-disabled={unavailable}
          onClick={unavailable ? undefined : onClick}
          className={`h-6 w-6 rounded-md text-[9px] focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 max-sm:h-11 max-sm:w-11 ${
            destructive ? "text-muted-foreground hover:text-destructive" : "text-muted-foreground"
          } ${unavailable ? "cursor-not-allowed opacity-35" : ""}`}
        >
          <span aria-hidden="true">{symbol}</span>
        </Button>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-[17rem] text-xs">
        <p className="font-medium">{label}</p>
        <p className="text-[11px] opacity-80">{hint}</p>
      </TooltipContent>
    </Tooltip>
  );
}

export function DataTab({ record }: { record: NodeRecord }) {
  const { l } = useTranslation();
  const { updateNode } = useBoard();
  const data = readStructure(record);
  const { columns, rows } = data;

  function save(
    nextColumns: string[],
    nextRows: string[][],
    extra: Record<string, unknown> = {},
    type = record.type,
  ) {
    updateNode(record.id, {
      type,
      content: structureText(type, nextColumns, nextRows),
      metadata: {
        ...(record.metadata ?? {}),
        columns: nextColumns,
        rows: nextRows,
        ...extra,
      },
    });
  }

  function setCell(rowIndex: number, colIndex: number, value: string) {
    const next = rows.map((row, i) =>
      i === rowIndex
        ? columns.map((_, c) => (c === colIndex ? value : (row[c] ?? "")))
        : columns.map((_, c) => row[c] ?? ""),
    );
    save(columns, next);
  }

  function moveRow(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= rows.length) return;
    const next = [...rows];
    const [moved] = next.splice(index, 1);
    next.splice(target, 0, moved!);
    save(columns, next);
  }

  return (
    <div className="flex h-full flex-col">
      <div className="shrink-0 space-y-2 border-b p-3">
        <Input
          value={record.title ?? ""}
          onChange={(e) => updateNode(record.id, { title: e.target.value })}
          placeholder={l("Titel des Moduls")}
          className="h-8 text-sm"
        />
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">{l("Darstellung")}</span>
          <div className="flex gap-1">
            {KINDS.map((kind) => (
              <button
                key={kind.id}
                onClick={() => save(columns, rows, {}, kind.id)}
                className={`rounded-full border px-2.5 py-0.5 text-[11px] ${
                  record.type === kind.id
                    ? "border-primary bg-accent/60"
                    : "text-muted-foreground hover:bg-secondary"
                }`}
              >
                {l(kind.label)}
              </button>
            ))}
          </div>
        </div>

        {record.type === "chart" && (
          <>
            <Select
              value={data.chartType}
              onValueChange={(value) => save(columns, rows, { chartType: value })}
            >
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CHART_TYPES.map((option) => (
                  <SelectItem key={option.id} value={option.id} className="text-xs">
                    {l(option.label)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <ChartDataSection
              record={record}
              columns={columns}
              onSaveMeta={(extra) => save(columns, rows, extra)}
            />

          </>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-3">
        <table className="w-full border-collapse text-xs">
          <caption className="sr-only">{l("Daten der Tabelle bearbeiten, verschieben oder löschen")}</caption>
          <thead>
            <tr>
              <th className="w-6" scope="col"><span className="sr-only">{l("Zeilen verschieben")}</span></th>
              {columns.map((column, index) => (
                <th key={index} className="p-1 align-bottom">
                  <div className="flex items-center gap-1">
                    <input
                      value={column}
                      aria-label={`Name von Spalte ${index + 1}`}
                      onChange={(e) =>
                        save(
                          columns.map((c, i) => (i === index ? e.target.value : c)),
                          rows,
                        )
                      }
                      className="w-full rounded border bg-transparent px-1.5 py-1 text-[11px] font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
                    />
                    <TableIconButton
                      symbol="✕"
                      destructive
                      label={`Spalte „${columns[index] || index + 1}“ löschen`}
                      hint={`Entfernt Spalte ${index + 1} und alle Werte dieser Spalte.`}
                      onClick={() =>
                        save(
                          columns.filter((_, i) => i !== index),
                          rows.map((row) => row.filter((_, i) => i !== index)),
                        )
                      }
                    />
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, rowIndex) => (
              <tr key={rowIndex}>
                <td className="align-middle">
                  <div className="flex flex-col text-[9px] text-muted-foreground">
                    <TableIconButton
                      symbol="▲"
                      label={`Zeile ${rowIndex + 1} nach oben verschieben`}
                      hint={rowIndex === 0 ? "Diese Zeile steht bereits ganz oben." : `Verschiebt Zeile ${rowIndex + 1} vor Zeile ${rowIndex}.`}
                      unavailable={rowIndex === 0}
                      onClick={() => moveRow(rowIndex, -1)}
                    />
                    <TableIconButton
                      symbol="▼"
                      label={`Zeile ${rowIndex + 1} nach unten verschieben`}
                      hint={rowIndex === rows.length - 1 ? "Diese Zeile steht bereits ganz unten." : `Verschiebt Zeile ${rowIndex + 1} hinter Zeile ${rowIndex + 2}.`}
                      unavailable={rowIndex === rows.length - 1}
                      onClick={() => moveRow(rowIndex, 1)}
                    />
                  </div>
                </td>
                {columns.map((_, colIndex) => (
                  <td key={colIndex} className="p-1">
                    <input
                      value={row[colIndex] ?? ""}
                      aria-label={`Zeile ${rowIndex + 1}, Spalte „${columns[colIndex] || colIndex + 1}“`}
                      onChange={(e) => setCell(rowIndex, colIndex, e.target.value)}
                      className="w-full rounded border bg-transparent px-1.5 py-1 outline-none focus:border-primary focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
                    />
                  </td>
                ))}
                <td className="pl-1">
                  <TableIconButton
                    symbol="✕"
                    destructive
                    label={`Zeile ${rowIndex + 1} löschen`}
                    hint={`Entfernt Zeile ${rowIndex + 1} und alle Werte dieser Zeile.`}
                    onClick={() => save(columns, rows.filter((_, i) => i !== rowIndex))}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {columns.length === 0 && (
          <p className="text-xs text-muted-foreground">
             {l("Noch keine Daten. Lege eine Spalte an oder hole die Daten im Reiter „Aktualisieren“.")}
          </p>
        )}
      </div>

      <div className="flex shrink-0 gap-2 border-t p-3">
        <Button
          size="sm"
          variant="secondary"
          onClick={() => save(columns, [...rows, columns.map(() => "")])}
          disabled={columns.length === 0}
        >
          {l("Zeile hinzufügen")}
        </Button>
        <Button
          size="sm"
          variant="secondary"
          onClick={() =>
            save(
              [...columns, `Spalte ${columns.length + 1}`],
              rows.map((row) => [...row, ""]),
            )
          }
        >
          {l("Spalte hinzufügen")}
        </Button>
      </div>
    </div>
  );
}
