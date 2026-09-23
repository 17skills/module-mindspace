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

export type RemoteEcho = { mark: (id: string) => void };

/**
 * Hält den Scope bei allen Beteiligten gleich: neue, geänderte und gelöschte
 * Module und Verbindungen kommen ohne Neuladen an.
 */
export function useBoardSync(
  boardId: string,
  enabled: boolean,
  handlers: Handlers,
): RemoteEcho {
  const echo = useRef(new Map<string, number>());
  const ref = useRef(handlers);
  ref.current = handlers;

  const mark = useRef((id: string) => {
    echo.current.set(id, Date.now());
  }).current;

  useEffect(() => {
    if (!enabled) return;
    const mine = (id: string) => {
      const at = echo.current.get(id);
      if (at && Date.now() - at < ECHO_MS) return true;
      if (at) echo.current.delete(id);
      return false;
    };

    const channel = supabase
      .channel(`board-sync:${boardId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "nodes", filter: `board_id=eq.${boardId}` },
        (payload) => {
          const row = (payload.new ?? payload.old) as Record<string, unknown>;
          const id = String(row?.["id"] ?? "");
          if (!id || mine(id)) return;
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
          if (!id || mine(id)) return;
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

  return { mark };
}
