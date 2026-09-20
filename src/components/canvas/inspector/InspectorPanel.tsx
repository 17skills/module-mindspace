import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useBoard, NODE_LABEL, type InspectorTab } from "@/components/canvas/board-context";
import type { Segment } from "@/lib/segments";
import { SourceTab } from "./SourceTab";
import { DataTab } from "./DataTab";
import { AssignTab } from "./AssignTab";
import { OverviewTab } from "./OverviewTab";
import { RefreshTab } from "./RefreshTab";
import { useSegments } from "./use-segments";

const DATA_TYPES = ["table", "list", "chart"];

type Props = {
  nodeId: string;
  tab: InspectorTab;
  onTab: (tab: InspectorTab) => void;
  onClose: () => void;
};

export function InspectorPanel({ nodeId, tab, onTab, onClose }: Props) {
  const { sourcesFor, updateNode } = useBoard();
  const sources = sourcesFor(nodeId);
  const record = sources.find((item) => item.id === nodeId) ?? sources[0];
  const [activeSource, setActiveSource] = useState(sources[0]?.id ?? nodeId);
  const [selection, setSelection] = useState<Record<string, string[]>>({});
  const [width, setWidth] = useState(440);
  const dragging = useRef(false);

  useEffect(() => {
    setActiveSource(sources[0]?.id ?? nodeId);
    setSelection({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeId]);

  useEffect(() => {
    function move(event: MouseEvent) {
      if (!dragging.current) return;
      setWidth(Math.min(720, Math.max(340, window.innerWidth - event.clientX)));
    }
    function up() {
      dragging.current = false;
    }
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    return () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
  }, []);

  const source = sources.find((item) => item.id === activeSource) ?? sources[0];
  const storeSegments = useCallback(
    (segments: Segment[]) => {
      if (!source) return;
      updateNode(source.id, {
        metadata: { ...(source.metadata ?? {}), segments },
      });
    },
    [source, updateNode],
  );

  const { segments, loading } = useSegments(source ?? (record as NonNullable<typeof record>), storeSegments);

  const selected = selection[source?.id ?? ""] ?? [];
  const selectedText = useMemo(() => {
    const ids = new Set(selected);
    return segments
      .filter((segment) => ids.has(segment.id))
      .map((segment) => `[${segment.label}]\n${segment.text}`)
      .join("\n\n");
  }, [segments, selected]);

  if (!record) return null;
  const isData = DATA_TYPES.includes(record.type);
  const tabs: { id: InspectorTab; label: string }[] = [
    { id: "source", label: "Quelle" },
    ...(isData ? [{ id: "data" as const, label: "Daten" }] : []),
    { id: "refresh", label: "Aktualisieren" },
    ...(record.type === "zone" ? [] : [{ id: "assign" as const, label: "Zuordnung" }]),
  ];
  const activeTab = tabs.some((item) => item.id === tab) ? tab : "source";

  return (
    <aside
      className="relative flex h-full shrink-0 flex-col border-l bg-card"
      style={{ width }}
      onContextMenu={(event) => event.stopPropagation()}
    >
      <div
        onMouseDown={() => {
          dragging.current = true;
        }}
        className="absolute inset-y-0 -left-1 w-2 cursor-col-resize"
        aria-hidden
      />

      <header className="flex shrink-0 items-start gap-2 border-b px-3 py-2.5">
        <div className="min-w-0 flex-1">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
            {NODE_LABEL[record.type] ?? record.type}
          </p>
          <p className="truncate text-sm font-medium">{record.title ?? "Ohne Titel"}</p>
        </div>
        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </header>

      <nav className="flex shrink-0 gap-1 border-b px-3 py-2">
        {tabs.map((item) => (
          <button
            key={item.id}
            onClick={() => onTab(item.id)}
            className={`rounded-full px-3 py-1 text-xs ${
              activeTab === item.id
                ? "bg-accent/60 font-medium"
                : "text-muted-foreground hover:bg-secondary"
            }`}
          >
            {item.label}
          </button>
        ))}
      </nav>

      {sources.length > 1 && activeTab !== "data" && (
        <div className="flex shrink-0 gap-1 overflow-x-auto border-b px-3 py-2">
          {sources.map((item) => (
            <button
              key={item.id}
              onClick={() => setActiveSource(item.id)}
              className={`shrink-0 rounded-full border px-2.5 py-0.5 text-[11px] ${
                source?.id === item.id ? "border-primary bg-accent/50" : "text-muted-foreground"
              }`}
            >
              {item.title ?? NODE_LABEL[item.type] ?? item.type}
            </button>
          ))}
        </div>
      )}

      <div className="min-h-0 flex-1">
        {activeTab === "source" && source && (
          <SourceTab
            record={source}
            segments={segments}
            loading={loading}
            selected={selected}
            onSelected={(ids) => setSelection((prev) => ({ ...prev, [source.id]: ids }))}
          />
        )}
        {activeTab === "data" && <DataTab record={record} />}
        {activeTab === "assign" && <AssignTab record={record} />}
        {activeTab === "refresh" && (
          <RefreshTab
            record={record}
            selectedText={selectedText}
            selectedCount={selected.length}
            sourceIds={source ? [source.id] : []}
          />
        )}
      </div>
    </aside>
  );
}
