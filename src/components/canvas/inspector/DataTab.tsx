import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { readStructure, structureText } from "@/lib/structure";
import { ChartDataSection } from "@/components/canvas/inspector/ChartDataSection";
import { useBoard, type NodeRecord } from "@/components/canvas/board-context";

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

export function DataTab({ record }: { record: NodeRecord }) {
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
          placeholder="Titel des Moduls"
          className="h-8 text-sm"
        />
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Darstellung</span>
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
                {kind.label}
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
                    {option.label}
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
          <thead>
            <tr>
              <th className="w-6" />
              {columns.map((column, index) => (
                <th key={index} className="p-1 align-bottom">
                  <div className="flex items-center gap-1">
                    <input
                      value={column}
                      onChange={(e) =>
                        save(
                          columns.map((c, i) => (i === index ? e.target.value : c)),
                          rows,
                        )
                      }
                      className="w-full rounded border bg-transparent px-1.5 py-1 text-[11px] font-medium outline-none"
                    />
                    <button
                      title="Spalte löschen"
                      className="text-muted-foreground hover:text-destructive"
                      onClick={() =>
                        save(
                          columns.filter((_, i) => i !== index),
                          rows.map((row) => row.filter((_, i) => i !== index)),
                        )
                      }
                    >
                      ✕
                    </button>
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
                    <button onClick={() => moveRow(rowIndex, -1)} title="nach oben">
                      ▲
                    </button>
                    <button onClick={() => moveRow(rowIndex, 1)} title="nach unten">
                      ▼
                    </button>
                  </div>
                </td>
                {columns.map((_, colIndex) => (
                  <td key={colIndex} className="p-1">
                    <input
                      value={row[colIndex] ?? ""}
                      onChange={(e) => setCell(rowIndex, colIndex, e.target.value)}
                      className="w-full rounded border bg-transparent px-1.5 py-1 outline-none focus:border-primary"
                    />
                  </td>
                ))}
                <td className="pl-1">
                  <button
                    className="text-muted-foreground hover:text-destructive"
                    title="Zeile löschen"
                    onClick={() => save(columns, rows.filter((_, i) => i !== rowIndex))}
                  >
                    ✕
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {columns.length === 0 && (
          <p className="text-xs text-muted-foreground">
            Noch keine Daten. Lege eine Spalte an oder hole die Daten im Reiter „Aktualisieren“.
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
          Zeile hinzufügen
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
          Spalte hinzufügen
        </Button>
      </div>
    </div>
  );
}
