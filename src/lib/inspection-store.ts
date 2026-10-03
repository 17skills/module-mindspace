import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Finding } from "@/lib/inspection";

/**
 * Befunde liegen je Zeile in `inspection_findings`, nicht im Modul.
 * So überschreibt der offene Canvas keine Befunde, die parallel vom Handy kommen.
 */
export function useInspectionFindings(nodeId: string, boardId: string) {
  const [rows, setRows] = useState<Record<string, unknown>[] | null>(null);
  const alive = useRef(true);

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from("inspection_findings")
      .select("data")
      .eq("node_id", nodeId)
      .order("created_at", { ascending: true });
    if (!error && alive.current) setRows((data ?? []).map((row) => row.data as Record<string, unknown>));
  }, [nodeId]);

  useEffect(() => {
    alive.current = true;
    void load();
    const timer = setInterval(() => void load(), 20_000);
    return () => {
      alive.current = false;
      clearInterval(timer);
    };
  }, [load]);

  /** Schreibt nur geänderte, neue und entfernte Befunde – nie die ganze Liste. */
  const save = useCallback(
    async (prev: Finding[], next: Finding[]) => {
      setRows(next as unknown as Record<string, unknown>[]);
      const before = new Map(prev.map((item) => [item.id, JSON.stringify(item)]));
      const changed = next.filter((item) => before.get(item.id) !== JSON.stringify(item));
      const keep = new Set(next.map((item) => item.id));
      const removed = prev.filter((item) => !keep.has(item.id)).map((item) => item.id);
      if (changed.length) {
        await supabase.from("inspection_findings").upsert(
          changed.map((item) => ({
            id: item.id,
            board_id: boardId,
            node_id: nodeId,
            data: item as never,
            ...(item.createdAt ? { created_at: item.createdAt } : {}),
          })),
        );
      }
      if (removed.length) await supabase.from("inspection_findings").delete().in("id", removed);
      await load();
    },
    [boardId, nodeId, load],
  );

  return { rows, save };
}
