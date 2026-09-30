import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useBoard, type NodeRecord } from "@/components/canvas/board-context";
import { ZONE_ROLES, readAssignment } from "@/lib/zones";
import { useTranslation } from "@/lib/i18n";

export function AssignTab({ record }: { record: NodeRecord }) {
  const { l } = useTranslation();
  const { zones, updateNode } = useBoard();
  const fields = zones();
  const assignment = readAssignment(record);
  const [note, setNote] = useState(assignment?.note ?? "");

  useEffect(() => {
    setNote(readAssignment(record)?.note ?? "");
  }, [record.id]); // eslint-disable-line react-hooks/exhaustive-deps

  function patch(next: Record<string, unknown>) {
    updateNode(record.id, { metadata: { ...(record.metadata ?? {}), ...next } });
  }

  return (
    <div className="h-full space-y-4 overflow-auto p-3 text-sm">
      <div>
        <p className="mb-1.5 text-xs font-medium text-muted-foreground">{l("Hintergrundfeld")}</p>
        {fields.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            {l("Auf dieser Fläche gibt es noch keine Hintergrundfelder. Lege sie per Rechtsklick an.")}
          </p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            <button
              onClick={() => patch({ zoneId: null, zoneAuto: false })}
              className={`rounded-full border px-2.5 py-1 text-xs ${
                assignment ? "text-muted-foreground" : "border-primary bg-accent/50"
              }`}
            >
              {l("Keines")}
            </button>
            {fields.map((zone) => (
              <button
                key={zone.id}
                onClick={() =>
                  patch({
                    zoneId: zone.id,
                    zoneAuto: false,
                    zoneRole: assignment?.role ?? ZONE_ROLES[0],
                  })
                }
                className={`rounded-full border px-2.5 py-1 text-xs ${
                  assignment?.zoneId === zone.id
                    ? "border-primary bg-accent/50"
                    : "text-muted-foreground hover:bg-secondary"
                }`}
              >
                {zone.title ?? l("Feld")}
              </button>
            ))}
          </div>
        )}
      </div>

      <div>
        <p className="mb-1.5 text-xs font-medium text-muted-foreground">{l("Rolle")}</p>
        <div className="flex flex-wrap gap-1.5">
          {ZONE_ROLES.map((role) => (
            <button
              key={role}
              onClick={() => patch({ zoneRole: role })}
              disabled={!assignment}
              className={`rounded-full border px-2.5 py-1 text-xs disabled:opacity-40 ${
                assignment?.role === role
                  ? "border-primary bg-accent/50"
                  : "text-muted-foreground hover:bg-secondary"
              }`}
            >
              {role}
            </button>
          ))}
        </div>
      </div>

      <div>
        <p className="mb-1.5 text-xs font-medium text-muted-foreground">
          {l("Warum gehört das hierher?")}
        </p>
        <Textarea
          value={note}
          onChange={(event) => setNote(event.target.value)}
          onBlur={() => patch({ zoneNote: note })}
          placeholder={l("z. B. zeigt ein Nutzenversprechen statt Produktmerkmalen")}
          className="min-h-20 text-xs"
        />
      </div>

      <label className="flex items-center gap-2 text-xs text-muted-foreground">
        <input
          type="checkbox"
          checked={assignment ? assignment.auto : true}
          onChange={(event) => patch({ zoneAuto: event.target.checked })}
        />
        {l("Automatisch nach Lage zuordnen")}
      </label>

      {assignment && (
        <Button
          size="sm"
          variant="ghost"
          onClick={() => patch({ zoneId: null, zoneNote: "", zoneAuto: true })}
        >
          {l("Zuordnung entfernen")}
        </Button>
      )}
    </div>
  );
}
