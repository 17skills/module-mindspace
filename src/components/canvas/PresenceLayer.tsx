import { memo, useMemo } from "react";
import { ViewportPortal, type Node } from "@xyflow/react";
import { MousePointer2 } from "lucide-react";
import { initialsOf, type PresencePeer } from "@/lib/presence";

/**
 * Zeigt die Mauszeiger der anderen Mitglieder und markiert Module,
 * an denen gerade jemand arbeitet – alles in Canvas-Koordinaten.
 */
export const PresenceLayer = memo(function PresenceLayer({ peers, nodes }: { peers: PresencePeer[]; nodes: Node[] }) {
  const editingIds = useMemo(
    () => new Set(peers.flatMap((peer) => (peer.editing ? [peer.editing] : []))),
    [peers],
  );
  const byId = useMemo(
    () => new Map(nodes.filter((node) => editingIds.has(node.id)).map((node) => [node.id, node])),
    [nodes, editingIds],
  );
  if (peers.length === 0) return null;

  return (
    <ViewportPortal>
      {peers.map((peer) => {
        const node = peer.editing ? byId.get(peer.editing) : undefined;
        if (!node) return null;
        const width = node.measured?.width ?? node.width ?? 260;
        const height = node.measured?.height ?? node.height ?? 120;
        return (
          <div
            key={`edit-${peer.userId}`}
            className="pointer-events-none absolute z-0 rounded-2xl"
            style={{
              transform: `translate(${node.position.x - 4}px, ${node.position.y - 4}px)`,
              width: width + 8,
              height: height + 8,
              border: `2px solid ${peer.color}`,
              boxShadow: `0 0 0 4px ${peer.color}1f`,
            }}
          >
            <span
              className="absolute -top-6 left-0 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium text-white"
              style={{ background: peer.color }}
            >
              {peer.name} bearbeitet
            </span>
          </div>
        );
      })}

      {peers.map((peer) =>
        peer.cursor ? (
          <div
            key={`cursor-${peer.userId}`}
            className="pointer-events-none absolute z-50"
            style={{
              transform: `translate(${peer.cursor.x}px, ${peer.cursor.y}px)`,
            }}
          >
            <MousePointer2
              className="size-5 drop-shadow"
              style={{ color: peer.color, fill: peer.color }}
            />
            <span
              className="ml-3 -mt-1 inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium text-white shadow"
              style={{ background: peer.color }}
            >
              {peer.name || initialsOf(peer.name)}
            </span>
          </div>
        ) : null,
      )}
    </ViewportPortal>
  );
});
