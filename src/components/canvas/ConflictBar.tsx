import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  describeValue,
  FIELD_LABEL,
  resolveConflict,
  useConflicts,
  type Conflict,
} from "@/lib/board-conflict";

/**
 * Hinweis auf gleichzeitige Änderungen: Alles Unstrittige wurde bereits
 * zusammengeführt, hier bleibt nur die Entscheidung bei echten Kollisionen.
 */
export function ConflictBar({
  onChoose,
}: {
  onChoose: (conflict: Conflict, keep: "mine" | "theirs") => void;
}) {
  const conflicts = useConflicts();
  if (!conflicts.length) return null;

  return (
    <div className="pointer-events-auto absolute bottom-4 left-1/2 z-30 w-[min(34rem,calc(100vw-2rem))] -translate-x-1/2 space-y-2">
      {conflicts.slice(0, 3).map((conflict) => (
        <div
          key={conflict.id}
          className="rounded-xl border border-[#d97706]/50 bg-card p-3 shadow-[var(--shadow-card)]"
        >
          <div className="flex items-center gap-2">
            <AlertTriangle className="size-4 text-[#d97706]" />
            <p className="min-w-0 flex-1 truncate text-sm font-medium">
              {conflict.nodeTitle} · {FIELD_LABEL[conflict.field] ?? conflict.field} gleichzeitig
              geändert
            </p>
          </div>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            <div className="rounded-md bg-secondary/60 p-2 text-xs">
              <p className="mb-0.5 font-medium">Deine Fassung</p>
              <p className="text-muted-foreground">{describeValue(conflict.mine)}</p>
            </div>
            <div className="rounded-md bg-secondary/60 p-2 text-xs">
              <p className="mb-0.5 font-medium">Fassung der anderen</p>
              <p className="text-muted-foreground">{describeValue(conflict.theirs)}</p>
            </div>
          </div>
          <div className="mt-2 flex justify-end gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                onChoose(conflict, "theirs");
                resolveConflict(conflict.id);
              }}
            >
              Fremde übernehmen
            </Button>
            <Button
              size="sm"
              onClick={() => {
                onChoose(conflict, "mine");
                resolveConflict(conflict.id);
              }}
            >
              Meine behalten
            </Button>
          </div>
        </div>
      ))}
      {conflicts.length > 3 && (
        <p className="text-center text-xs text-muted-foreground">
          … und {conflicts.length - 3} weitere Entscheidungen
        </p>
      )}
    </div>
  );
}
