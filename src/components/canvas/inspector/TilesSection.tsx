import { Switch } from "@/components/ui/switch";
import { useBoard, type NodeRecord } from "@/components/canvas/board-context";
import { readOutputFormat } from "@/lib/genui-tiles";
import { useTranslation } from "@/lib/i18n";

/** Schalter "Ergebnis als interaktive Kacheln" für Module mit Ergebnissen. */
export function TilesSection({ record }: { record: NodeRecord }) {
  const { l } = useTranslation();
  const { updateNode } = useBoard();
  const on = readOutputFormat(record.metadata as Record<string, unknown>) === "tiles";
  return (
    <div className="flex shrink-0 items-start gap-3 border-b px-4 py-3">
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium">{l("Ergebnis als interaktive Kacheln")}</p>
        <p className="text-[11px] text-muted-foreground">
          {l("Kennzahlen, Tabelle und Entscheidungsknöpfe in der App statt Liste.")}
        </p>
      </div>
      <Switch
        checked={on}
        aria-label={l("Ergebnis als interaktive Kacheln")}
        onCheckedChange={(next) =>
          updateNode(record.id, { metadata: { ...(record.metadata ?? {}), outputFormat: next ? "tiles" : "text" } })
        }
      />
    </div>
  );
}
