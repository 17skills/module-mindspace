import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { extractStructured } from "@/lib/ingest.functions";
import { readStructure } from "@/lib/structure";
import { useBoard, type NodeRecord, type StructureItem } from "@/components/canvas/board-context";
import { useTranslation } from "@/lib/i18n";

type Props = {
  record: NodeRecord;
  /** Text of the segments the user ticked in the source tab. */
  selectedText: string;
  selectedCount: number;
  sourceIds: string[];
};

const DATA_TYPES = ["table", "list", "chart"];

export function RefreshTab({ record, selectedText, selectedCount, sourceIds }: Props) {
  const { l, locale } = useTranslation();
  const { applyStructure, createStructure } = useBoard();
  const [instruction, setInstruction] = useState("");
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<StructureItem | null>(null);

  const isData = DATA_TYPES.includes(record.type);
  const kind = isData ? (record.type as "table" | "list" | "chart") : "auto";

  async function run() {
    const text = selectedText.trim();
    if (!text) {
      toast.error(l("Bitte wähle im Reiter „Quelle“ mindestens eine Stelle aus."));
      return;
    }
    setBusy(true);
    try {
      const result = await extractStructured({
        data: {
          text,
          title: record.title ?? "",
          instruction,
          kind,
          max: 1,
        },
      });
      const item = result.items?.[0];
      if (!item) {
        toast.error(l("In der Auswahl wurden keine strukturierten Daten gefunden."));
        return;
      }
      setPreview(item as StructureItem);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : l("Extraktion fehlgeschlagen"));
    } finally {
      setBusy(false);
    }
  }

  const current = isData ? readStructure(record) : null;

  return (
    <div className="flex h-full flex-col">
      <div className="shrink-0 space-y-2 border-b p-3">
        <p className="text-xs text-muted-foreground">
          {selectedCount > 0
            ? `${selectedCount} ${locale === "en-GB" ? "item(s) selected" : "Stelle(n) ausgewählt"} (${selectedText.length.toLocaleString(locale)} ${locale === "en-GB" ? "characters" : "Zeichen"}).`
            : "Wähle im Reiter „Quelle“ die Seiten oder Abschnitte aus, die verwendet werden sollen."}
        </p>
        <Textarea
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          placeholder="Was soll herausgelöst werden? z. B. „Nur die Umsatztabelle je Quartal“"
          className="min-h-20 text-xs"
        />
        <Button size="sm" onClick={run} disabled={busy || selectedCount === 0}>
          {l(busy ? "Wird ausgewertet …" : "Daten holen")}
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-3">
        {!preview && (
          <p className="text-xs text-muted-foreground">
            {l("Das Ergebnis erscheint hier zur Vorschau, bevor du es übernimmst.")}
          </p>
        )}
        {preview && (
          <div className="space-y-2">
            <p className="text-xs font-medium">{preview.title}</p>
            <table className="w-full border-collapse text-[11px]">
              <thead>
                <tr>
                  {preview.columns.map((column, index) => (
                    <th key={index} className="border-b p-1 text-left font-medium">
                      {column}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {preview.rows.slice(0, 40).map((row, rowIndex) => (
                  <tr key={rowIndex}>
                    {preview.columns.map((_, colIndex) => (
                      <td key={colIndex} className="border-b p-1 text-muted-foreground">
                        {row[colIndex] ?? ""}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            {current && (
              <p className="text-[11px] text-muted-foreground">
                Bisher: {current.rows.length} Zeile(n) · Neu: {preview.rows.length} Zeile(n)
              </p>
            )}
          </div>
        )}
      </div>

      {preview && (
        <div className="flex shrink-0 gap-2 border-t p-3">
          {isData && (
            <Button
              size="sm"
              onClick={() => {
                applyStructure(record.id, preview);
                setPreview(null);
                toast.success(l("Daten ersetzt"));
              }}
            >
              {l("Daten ersetzen")}
            </Button>
          )}
          <Button
            size="sm"
            variant="secondary"
            onClick={async () => {
              await createStructure(preview, sourceIds);
              setPreview(null);
              toast.success(l("Neues Modul angelegt"));
            }}
          >
            {l("Als neues Modul")}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setPreview(null)}>
            {l("Verwerfen")}
          </Button>
        </div>
      )}
    </div>
  );
}
