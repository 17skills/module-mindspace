/**
 * Kamera-Quelle: Foto aufnehmen, Ort (aus dem Foto oder vom Gerät) weitergeben.
 * Auf dem Canvas beschreibt sie nur, was sie liefert – aufgenommen wird in der App.
 */
import { memo } from "react";
import { NodeResizer, Position, type NodeProps } from "@xyflow/react";
import { Camera } from "lucide-react";
import { useBoard, type NodeRecord } from "./board-context";
import { SignalHandle } from "./nodes";

export const CameraNode = memo(function CameraNode({ data, selected }: NodeProps) {
  const record = (data as unknown as { record: NodeRecord }).record;
  const { deleteNode } = useBoard();
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
        <button
          className="nodrag flex size-6 items-center justify-center rounded-full text-xs text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
          onClick={() => deleteNode(record.id)}
          aria-label="Modul löschen"
        >
          ✕
        </button>
      </div>
      <div className="flex flex-1 gap-3 px-3 py-3 text-sm">
        <Camera className="size-8 shrink-0 text-muted-foreground" />
        <div className="space-y-1">
          <p>Nimmt in der App ein Foto auf und gibt den Ort weiter.</p>
          <p className="text-xs text-muted-foreground">
            Verbundene Schritte erhalten <code>{"{{input.lat}}"}</code> und <code>{"{{input.lon}}"}</code>. Das Foto bleibt auf dem Gerät.
          </p>
        </div>
      </div>
      <SignalHandle type="source" position={Position.Right} />
    </div>
  );
});
