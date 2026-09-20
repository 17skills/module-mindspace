import { useMemo } from "react";
import { Crosshair, X } from "lucide-react";
import { useBoard, NODE_LABEL, type NodeRecord } from "@/components/canvas/board-context";
import { ZONE_ROLES, readAssignment } from "@/lib/zones";

export function OverviewTab({ onOpen }: { onOpen: (id: string) => void }) {
  const { allNodes, updateNode, focusNode } = useBoard();
  const nodes = allNodes();

  const { zones, byZone, unassigned } = useMemo(() => {
    const zones = nodes.filter((item) => item.type === "zone");
    const cards = nodes.filter((item) => item.type !== "zone" && item.type !== "frame");
    const byZone: Record<string, NodeRecord[]> = {};
    const unassigned: NodeRecord[] = [];
    for (const card of cards) {
      const assignment = readAssignment(card);
      const zone = assignment && zones.find((item) => item.id === assignment.zoneId);
      if (zone) (byZone[zone.id] ??= []).push(card);
      else unassigned.push(card);
    }
    return { zones, byZone, unassigned };
  }, [nodes]);

  function patch(card: NodeRecord, next: Record<string, unknown>) {
    updateNode(card.id, { metadata: { ...(card.metadata ?? {}), ...next } });
  }

  function Row({ card, assigned }: { card: NodeRecord; assigned: boolean }) {
    const assignment = readAssignment(card);
    return (
      <div className="flex items-center gap-1.5 rounded-md border px-2 py-1.5">
        <button
          onClick={() => {
            focusNode(card.id);
            onOpen(card.id);
          }}
          className="min-w-0 flex-1 text-left"
          title="Auf der Fläche zeigen"
        >
          <span className="mr-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">
            {NODE_LABEL[card.type] ?? card.type}
          </span>
          <span className="truncate text-xs">{card.title ?? "Ohne Titel"}</span>
        </button>

        {assigned ? (
          <>
            <select
              value={assignment?.role ?? ZONE_ROLES[0]}
              onChange={(event) => patch(card, { zoneRole: event.target.value, zoneAuto: false })}
              className="rounded border bg-background px-1 py-0.5 text-[11px]"
            >
              {ZONE_ROLES.map((role) => (
                <option key={role} value={role}>
                  {role}
                </option>
              ))}
            </select>
            <button
              onClick={() => patch(card, { zoneId: null, zoneAuto: false })}
              title="Zuordnung entfernen"
              className="rounded p-1 text-muted-foreground hover:bg-secondary"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </>
        ) : (
          <select
            value=""
            onChange={(event) =>
              event.target.value &&
              patch(card, {
                zoneId: event.target.value,
                zoneAuto: false,
                zoneRole: assignment?.role ?? ZONE_ROLES[0],
              })
            }
            className="rounded border bg-background px-1 py-0.5 text-[11px]"
          >
            <option value="">Feld wählen …</option>
            {zones.map((zone) => (
              <option key={zone.id} value={zone.id}>
                {zone.title ?? "Feld"}
              </option>
            ))}
          </select>
        )}
      </div>
    );
  }

  return (
    <div className="h-full space-y-4 overflow-auto p-3">
      {zones.length === 0 && (
        <p className="text-xs text-muted-foreground">
          Auf dieser Fläche gibt es noch keine Hintergrundfelder. Lege sie per Rechtsklick an.
        </p>
      )}

      {zones.map((zone) => {
        const members = byZone[zone.id] ?? [];
        return (
          <section key={zone.id}>
            <div className="mb-1.5 flex items-center gap-1.5">
              <span
                className="h-2.5 w-2.5 rounded-full"
                style={{ background: zone.color ?? "var(--frame)" }}
              />
              <p className="flex-1 truncate text-xs font-medium">{zone.title ?? "Feld"}</p>
              <span className="text-[11px] text-muted-foreground">{members.length}</span>
              <button
                onClick={() => focusNode(zone.id)}
                title="Feld zeigen"
                className="rounded p-1 text-muted-foreground hover:bg-secondary"
              >
                <Crosshair className="h-3.5 w-3.5" />
              </button>
            </div>
            {members.length === 0 ? (
              <p className="pl-4 text-[11px] text-muted-foreground">Noch nichts zugeordnet</p>
            ) : (
              <div className="space-y-1">
                {members.map((card) => (
                  <Row key={card.id} card={card} assigned />
                ))}
              </div>
            )}
          </section>
        );
      })}

      <section>
        <p className="mb-1.5 text-xs font-medium text-muted-foreground">
          Ohne Zuordnung ({unassigned.length})
        </p>
        {unassigned.length === 0 ? (
          <p className="pl-1 text-[11px] text-muted-foreground">Alles zugeordnet</p>
        ) : (
          <div className="space-y-1">
            {unassigned.map((card) => (
              <Row key={card.id} card={card} assigned={false} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
