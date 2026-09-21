import { NODE_ACCENT } from "@/components/canvas/board-context";
import type { LibraryPayload } from "@/lib/library";
import { cn } from "@/lib/utils";

/** Schematic miniature of a library entry: boxes per module plus connection lines. */
export function LibraryPreview({
  payload,
  className,
}: {
  payload: LibraryPayload;
  className?: string;
}) {
  const width = Math.max(payload.bounds.width, 1);
  const height = Math.max(payload.bounds.height, 1);
  const pos = new Map(payload.nodes.map((node) => [node.localId, node]));
  const absolute = (id: string) => {
    let node = pos.get(id);
    let x = 0;
    let y = 0;
    let guard = 0;
    while (node && guard++ < 10) {
      x += node.x;
      y += node.y;
      node = node.parentLocalId ? pos.get(node.parentLocalId) : undefined;
    }
    return { x, y };
  };

  return (
    <div
      className={cn(
        "relative w-full overflow-hidden rounded-lg border border-border/70 bg-canvas",
        className,
      )}
    >
      <svg className="absolute inset-0 h-full w-full" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
        {payload.edges.map((edge, index) => {
          const source = pos.get(edge.source);
          const target = pos.get(edge.target);
          if (!source || !target) return null;
          const a = absolute(edge.source);
          const b = absolute(edge.target);
          return (
            <line
              key={index}
              x1={a.x + source.w / 2}
              y1={a.y + source.h / 2}
              x2={b.x + target.w / 2}
              y2={b.y + target.h / 2}
              stroke="var(--border)"
              strokeWidth={Math.max(width, height) / 220}
            />
          );
        })}
      </svg>
      {payload.nodes.map((node) => {
        const at = absolute(node.localId);
        const accent = node.type === "zone" ? "var(--border)" : NODE_ACCENT[node.type] ?? "var(--primary)";
        return (
          <div
            key={node.localId}
            className="absolute rounded-[3px] border bg-card"
            style={{
              left: `${(at.x / width) * 100}%`,
              top: `${(at.y / height) * 100}%`,
              width: `${(node.w / width) * 100}%`,
              height: `${(node.h / height) * 100}%`,
              borderColor: accent,
              borderLeftWidth: 3,
              borderLeftColor: accent,
              opacity: node.type === "zone" || node.type === "frame" ? 0.6 : 1,
            }}
          />
        );
      })}
      {payload.nodes.length === 0 ? (
        <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
          Keine Module
        </div>
      ) : null}
    </div>
  );
}
