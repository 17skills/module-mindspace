import type { NodeRecord, StructureItem } from "@/components/canvas/board-context";

export type StructureData = {
  columns: string[];
  rows: string[][];
  chartType: "bar" | "line" | "pie";
  labelColumn: number;
  valueColumn: number;
};

export function readStructure(record: NodeRecord): StructureData {
  const meta = (record.metadata ?? {}) as Record<string, unknown>;
  const columns = Array.isArray(meta["columns"]) ? (meta["columns"] as string[]) : [];
  const rows = Array.isArray(meta["rows"]) ? (meta["rows"] as string[][]) : [];
  const chartType = (meta["chartType"] as StructureData["chartType"]) ?? "bar";
  const labelColumn = Number(meta["labelColumn"] ?? 0) || 0;
  const valueColumn = Number(meta["valueColumn"] ?? 1) || (columns.length > 1 ? 1 : 0);
  return { columns, rows, chartType, labelColumn, valueColumn };
}

/** Mirror of the data as plain text so the chat context stays readable. */
export function structureText(kind: string, columns: string[], rows: string[][]) {
  if (kind === "list") return rows.map((row) => `- ${row[0] ?? ""}`).join("\n");
  return [columns.join(" | "), ...rows.map((row) => row.join(" | "))].join("\n");
}

export function itemToPatch(item: StructureItem): Partial<NodeRecord> {
  return {
    type: item.kind,
    title: item.title,
    content: structureText(item.kind, item.columns, item.rows),
    metadata: {
      columns: item.columns,
      rows: item.rows,
      chartType: item.chartType === "none" ? "bar" : item.chartType,
      labelColumn: 0,
      valueColumn: item.columns.length > 1 ? 1 : 0,
    },
  };
}

export function chartSeries(data: StructureData) {
  return data.rows.map((row) => ({
    name: row[data.labelColumn] ?? "",
    value:
      Number(
        String(row[data.valueColumn] ?? "0")
          .replace(/[^\d.,-]/g, "")
          .replace(/\.(?=\d{3}\b)/g, "")
          .replace(",", "."),
      ) || 0,
  }));
}
