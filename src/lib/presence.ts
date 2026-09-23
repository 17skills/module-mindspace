import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

/**
 * Live-Zusammenarbeit auf einem Scope.
 *
 * Identität und Bearbeitungshinweise laufen über Supabase Presence (selten,
 * aber verlässlich), die Mauszeiger über Broadcast (häufig, aber flüchtig).
 */

export type PresencePeer = {
  userId: string;
  name: string;
  color: string;
  /** Modul, das die Person gerade ausgewählt hat bzw. bearbeitet. */
  editing: string | null;
  /** Zeigerposition in Canvas-Koordinaten. */
  cursor: { x: number; y: number } | null;
  updatedAt: number;
};

const COLORS = [
  "#598381",
  "#e0682b",
  "#4f8a5b",
  "#6b7fb8",
  "#b0567f",
  "#8a6f3c",
  "#3f7f9c",
  "#a15c4a",
];

export function colorForUser(userId: string): string {
  let hash = 0;
  for (let i = 0; i < userId.length; i += 1) hash = (hash * 31 + userId.charCodeAt(i)) >>> 0;
  return COLORS[hash % COLORS.length]!;
}

export function initialsOf(name: string): string {
  const parts = name.trim().split(/[\s@._-]+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
}

type Meta = { userId: string; name: string; color: string; editing: string | null };
type CursorMsg = { userId: string; x: number; y: number };

/** Zeiger, die länger stillstehen, blenden wir aus. */
const CURSOR_TTL = 15_000;

export function useBoardPresence(params: {
  boardId: string;
  userId: string | null;
  name: string;
  enabled?: boolean;
}) {
  const { boardId, userId, name, enabled = true } = params;
  const [metas, setMetas] = useState<Record<string, Meta>>({});
  const [cursors, setCursors] = useState<Record<string, { x: number; y: number; at: number }>>({});
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const editingRef = useRef<string | null>(null);
  const lastSent = useRef(0);
  const color = useMemo(() => (userId ? colorForUser(userId) : COLORS[0]!), [userId]);

  useEffect(() => {
    if (!enabled || !userId) return;
    const channel = supabase.channel(`scope:${boardId}`, {
      config: { presence: { key: userId }, broadcast: { self: false } },
    });
    channelRef.current = channel;

    const readState = () => {
      const state = channel.presenceState<Meta>();
      const next: Record<string, Meta> = {};
      for (const [key, entries] of Object.entries(state)) {
        const last = entries[entries.length - 1] as Meta | undefined;
        if (last && key !== userId) next[key] = { ...last, userId: key };
      }
      setMetas(next);
    };

    channel
      .on("presence", { event: "sync" }, readState)
      .on("presence", { event: "join" }, readState)
      .on("presence", { event: "leave" }, readState)
      .on("broadcast", { event: "cursor" }, ({ payload }) => {
        const msg = payload as CursorMsg;
        if (!msg?.userId || msg.userId === userId) return;
        setCursors((current) => ({
          ...current,
          [msg.userId]: { x: msg.x, y: msg.y, at: Date.now() },
        }));
      })
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          void channel.track({ userId, name, color, editing: editingRef.current });
        }
      });

    return () => {
      channelRef.current = null;
      void supabase.removeChannel(channel);
    };
  }, [boardId, userId, name, color, enabled]);

  // Veraltete Zeiger aufräumen
  useEffect(() => {
    const timer = setInterval(() => {
      setCursors((current) => {
        const now = Date.now();
        const next: typeof current = {};
        let changed = false;
        for (const [key, value] of Object.entries(current)) {
          if (now - value.at < CURSOR_TTL) next[key] = value;
          else changed = true;
        }
        return changed ? next : current;
      });
    }, 5000);
    return () => clearInterval(timer);
  }, []);

  /** Zeigerposition senden (max. ~20x pro Sekunde). */
  const sendCursor = useCallback(
    (x: number, y: number) => {
      const channel = channelRef.current;
      if (!channel || !userId) return;
      const now = Date.now();
      if (now - lastSent.current < 50) return;
      lastSent.current = now;
      void channel.send({
        type: "broadcast",
        event: "cursor",
        payload: { userId, x, y } satisfies CursorMsg,
      });
    },
    [userId],
  );

  /** Bearbeitungshinweis setzen: welches Modul ist gerade in Arbeit. */
  const setEditing = useCallback(
    (nodeId: string | null) => {
      if (editingRef.current === nodeId) return;
      editingRef.current = nodeId;
      const channel = channelRef.current;
      if (!channel || !userId) return;
      void channel.track({ userId, name, color, editing: nodeId });
    },
    [userId, name, color],
  );

  const peers = useMemo<PresencePeer[]>(() => {
    return Object.values(metas).map((meta) => {
      const cursor = cursors[meta.userId];
      return {
        userId: meta.userId,
        name: meta.name || "Gast",
        color: meta.color || colorForUser(meta.userId),
        editing: meta.editing ?? null,
        cursor: cursor ? { x: cursor.x, y: cursor.y } : null,
        updatedAt: cursor?.at ?? 0,
      };
    });
  }, [metas, cursors]);

  return { peers, sendCursor, setEditing, myColor: color };
}
