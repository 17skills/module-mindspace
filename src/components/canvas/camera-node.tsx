/**
 * Kamera-Quelle: Foto aufnehmen, Ort (aus dem Foto oder vom Gerät) weitergeben.
 * Auf dem Canvas beschreibt sie nur, was sie liefert – aufgenommen wird in der App.
 */
import { memo, useEffect, useState } from "react";
import { NodeResizer, Position, type NodeProps } from "@xyflow/react";
import { Camera } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useBoard, type NodeRecord } from "./board-context";
import { SignalHandle } from "./nodes";

type Shot = { id: string; url: string | null; created_at: string };

/** Letzte Aufnahmen dieser Kamera-Quelle – eigene Zeilen je Foto, kein Schreibkonflikt. */
function useCaptures(nodeId: string) {
  const [shots, setShots] = useState<Shot[]>([]);
  const [count, setCount] = useState(0);
  useEffect(() => {
    let alive = true;
    const load = async () => {
      const { data, count: total } = await supabase
        .from("captures")
        .select("id,photo_path,created_at", { count: "exact" })
        .eq("node_id", nodeId)
        .order("created_at", { ascending: false })
        .limit(6);
      if (!alive) return;
      const rows = data ?? [];
      const paths = rows.map((r) => r.photo_path).filter((p): p is string => !!p);
      const signed = paths.length
        ? (await supabase.storage.from("field-photos").createSignedUrls(paths, 3600)).data ?? []
        : [];
      const byPath = new Map(signed.map((s) => [s.path, s.signedUrl]));
      if (!alive) return;
      setCount(total ?? rows.length);
      setShots(rows.map((r) => ({ id: r.id, created_at: r.created_at, url: r.photo_path ? byPath.get(r.photo_path) ?? null : null })));
    };
    void load();
    const timer = window.setInterval(() => void load(), 60_000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [nodeId]);
  return { shots, count };
}

export const CameraNode = memo(function CameraNode({ data, selected }: NodeProps) {
  const record = (data as unknown as { record: NodeRecord }).record;
  const { deleteNode } = useBoard();
  const { shots, count } = useCaptures(record.id);
  return (
    <div
      className={`module-card flex h-full w-full flex-col overflow-hidden border bg-card ${
        selected ? "border-ring/60 shadow-[var(--shadow-float)]" : "border-border/70"
      }`}
      data-selected={Boolean(selected)}
    >
      <NodeResizer isVisible={Boolean(selected)} minWidth={240} minHeight={160} />
      <div className="module-heading flex items-center gap-2 border-b px-3 py-2">
        <span className="rounded-md bg-secondary px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide">Quelle</span>
        <span className="line-clamp-1 flex-1 text-sm font-medium">{record.title || "Kamera"}</span>
        <span className="text-xs text-muted-foreground">{count} Fotos</span>
        <button
          className="nodrag flex size-6 items-center justify-center rounded-full text-xs text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
          onClick={() => deleteNode(record.id)}
          aria-label="Modul löschen"
        >
          ✕
        </button>
      </div>
      {shots.length ? (
        <div className="grid flex-1 grid-cols-3 gap-1 p-2">
          {shots.map((shot) =>
            shot.url ? (
              <a key={shot.id} href={shot.url} target="_blank" rel="noreferrer" className="nodrag" title={new Date(shot.created_at).toLocaleString("de-DE")}>
                <img src={shot.url} alt="Aufnahme" className="aspect-square w-full rounded object-cover" loading="lazy" />
              </a>
            ) : null,
          )}
        </div>
      ) : (
        <div className="flex flex-1 gap-3 px-3 py-3 text-sm">
          <Camera className="size-8 shrink-0 text-muted-foreground" />
          <div className="space-y-1">
            <p>Nimmt in der App ein Foto auf und überträgt es mit dem Ort.</p>
            <p className="text-xs text-muted-foreground">
              Verbundene Schritte erhalten <code>{"{{input.lat}}"}</code> und <code>{"{{input.lon}}"}</code>.
            </p>
          </div>
        </div>
      )}
      <SignalHandle type="source" position={Position.Right} />
    </div>
  );
});
