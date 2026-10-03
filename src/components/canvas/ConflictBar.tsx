import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  describeChanges,
  describeValue,
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
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-[#d97706]" />
            <div className="min-w-0 flex-1">
              <p className="break-words text-sm font-medium">
                {conflict.nodeTitle}: {FIELD_LABEL[conflict.field] ?? conflict.field} wurde gleichzeitig
                woanders geändert
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Zum Beispiel in einem zweiten Fenster oder von einer anderen Person. Welche Fassung soll gelten?
              </p>
            </div>
          </div>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {(
              [
                ["Deine Fassung", conflict.mine, conflict.theirs],
                ["Andere Fassung", conflict.theirs, conflict.mine],
              ] as const
            ).map(([label, value, other]) => {
              const lines =
                conflict.field === "metadata"
                  ? describeChanges(value, other)
                  : [describeValue(value)];
              return (
                <div key={label} className="min-w-0 overflow-hidden rounded-md bg-secondary/60 p-2 text-xs">
                  <p className="mb-1 font-medium">{label}</p>
                  <ul className="max-h-24 space-y-0.5 overflow-y-auto text-muted-foreground">
                    {(lines.length ? lines : ["keine Abweichung"]).map((line) => (
                      <li key={line} className="break-words">{line}</li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
          <div className="mt-2 flex flex-wrap justify-end gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                onChoose(conflict, "theirs");
                resolveConflict(conflict.id);
              }}
            >
              Andere übernehmen
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
