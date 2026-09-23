import { useEffect, useRef } from "react";
import type { Edge } from "@xyflow/react";
import { supabase } from "@/integrations/supabase/client";
import type { NodeRecord } from "@/components/canvas/board-context";

/** Änderungen, die gerade selbst geschrieben wurden, kurz ignorieren. */
const ECHO_MS = 2500;

type Handlers = {
  upsertNode: (record: NodeRecord) => void;
  removeNode: (id: string) => void;
  upsertEdge: (edge: Edge) => void;
  removeEdge: (id: string) => void;
};

const echo = new Map<string, number>();

/** Eigene Schreibvorgänge merken, damit sie nicht als fremde Änderung zurückkommen. */
export function markSelfWrite(...ids: (string | null | undefined)[]) {
  const now = Date.now();
  for (const id of ids) if (id) echo.set(id, now);
}

function isEcho(id: string) {
  const at = echo.get(id);
  if (at && Date.now() - at < ECHO_MS) return true;
  if (at) echo.delete(id);
  return false;
}

/**
 * Hält den Scope bei allen Beteiligten gleich: neue, geänderte und gelöschte
 * Module und Verbindungen kommen ohne Neuladen an.
 */
export function useBoardSync(boardId: string, enabled: boolean, handlers: Handlers): void {
  const ref = useRef(handlers);
  ref.current = handlers;

  useEffect(() => {
    if (!enabled) return;
    const channel = supabase
      .channel(`board-sync:${boardId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "nodes", filter: `board_id=eq.${boardId}` },
        (payload) => {
          const row = (payload.new ?? payload.old) as Record<string, unknown>;
          const id = String(row?.["id"] ?? "");
          if (!id || isEcho(id)) return;
          if (payload.eventType === "DELETE") ref.current.removeNode(id);
          else ref.current.upsertNode(payload.new as unknown as NodeRecord);
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "edges", filter: `board_id=eq.${boardId}` },
        (payload) => {
          const row = (payload.new ?? payload.old) as Record<string, unknown>;
          const id = String(row?.["id"] ?? "");
          if (!id || isEcho(id)) return;
          if (payload.eventType === "DELETE") {
            ref.current.removeEdge(id);
            return;
          }
          const next = payload.new as Record<string, unknown>;
          ref.current.upsertEdge({
            id,
            source: String(next["source_id"]),
            target: String(next["target_id"]),
            type: "labeled",
            ...(next["label"] ? { label: String(next["label"]) } : {}),
          });
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [boardId, enabled]);
}
