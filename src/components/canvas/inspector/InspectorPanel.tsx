import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useBoard, NODE_LABEL, type InspectorTab } from "@/components/canvas/board-context";
import type { Segment } from "@/lib/segments";
import { SourceTab } from "./SourceTab";
import { RowsTab } from "./RowsTab";
import { DataTab } from "./DataTab";
import { AssignTab } from "./AssignTab";
import { AgentTab } from "./AgentTab";
import { FetchTab } from "./FetchTab";
import { GuideTab } from "./GuideTab";
import { RefreshTab } from "./RefreshTab";
import { TriggerTab } from "./TriggerTab";
import { RoleSection } from "./RoleSection";
import { useSegments } from "./use-segments";
import { readDatasetRef } from "@/lib/datasets";
import { readSource } from "@/lib/source-node";
import { useTranslation } from "@/lib/i18n";


const DATA_TYPES = ["table", "list", "chart"];

type Props = {
  nodeId: string;
  tab: InspectorTab;
  onTab: (tab: InspectorTab) => void;
  onClose: () => void;
};

export function InspectorPanel({ nodeId, tab, onTab, onClose }: Props) {
  const { l } = useTranslation();
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
  const isZone = record.type === "zone";
  const isApi = record.type === "api";
  const hasDataset = Boolean(readDatasetRef(readSource(record)?.envelope));
  const tabs: { id: InspectorTab; label: string }[] = [
    ...(isZone ? [{ id: "agent" as const, label: l("Agent") }] : []),
    ...(isApi ? [{ id: "fetch" as const, label: l("Abruf") }] : []),
    ...(hasDataset ? [{ id: "rows" as const, label: l("Tabelle") }] : []),
    { id: "source", label: l("Quelle") },
    ...(isData ? [{ id: "data" as const, label: l("Daten") }] : []),
    { id: "refresh", label: l("Aktualisieren") },
    { id: "trigger", label: l("Auslöser") },
    ...(isZone ? [] : [{ id: "assign" as const, label: l("Zuordnung") }]),
    { id: "guide", label: l("Leitfaden") },
  ];
  const activeTab = tabs.some((item) => item.id === tab)
    ? tab
    : hasDataset
      ? "rows"
      : "source";

  return (
    <aside
      className="relative flex h-auto max-h-full shrink-0 flex-col self-start border-b border-l bg-card shadow-sm max-sm:fixed max-sm:inset-x-0 max-sm:top-14 max-sm:z-40 max-sm:max-h-[calc(100dvh-3.5rem)] max-sm:border-l-0 sm:w-(--inspector-w)"
      style={{ "--inspector-w": `${width}px` } as React.CSSProperties}
      onContextMenu={(event) => event.stopPropagation()}
    >
      <div
        onMouseDown={() => {
          dragging.current = true;
        }}
        className="absolute inset-y-0 -left-1 w-2 cursor-col-resize max-sm:hidden"
        aria-hidden
      />

      <header className="flex shrink-0 items-start gap-2 border-b px-4 py-3">
        <div className="min-w-0 flex-1">
          <p className="text-[10px] uppercase text-muted-foreground">
            {NODE_LABEL[record.type] ?? record.type}
          </p>
          <p className="truncate font-display text-sm font-semibold">{record.title ?? (l("Ohne Titel"))}</p>
        </div>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button size="icon" variant="ghost" className="h-7 w-7 max-sm:h-9 max-sm:w-9" aria-label={l("Inspector schließen")} onClick={onClose}>
              <X className="h-4 w-4" aria-hidden="true" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="text-xs">{l("Schließen")}</TooltipContent>
        </Tooltip>
      </header>

      <RoleSection record={record} />

      <nav className="flex shrink-0 gap-1 overflow-x-auto border-b px-3 py-2">

        {tabs.map((item) => (
          <button
            key={item.id}
            onClick={() => onTab(item.id)}
            className={`shrink-0 whitespace-nowrap rounded-lg px-3 py-1.5 text-xs transition-colors ${
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

      <div className="min-h-0 flex-1 overflow-y-auto">
        {activeTab === "source" && source && (
          <SourceTab
            record={source}
            segments={segments}
            loading={loading}
            selected={selected}
            onSelected={(ids) => setSelection((prev) => ({ ...prev, [source.id]: ids }))}
          />
        )}
        {activeTab === "rows" && <RowsTab record={record} />}
        {activeTab === "data" && <DataTab record={record} />}
        {activeTab === "assign" && <AssignTab record={record} />}
        {activeTab === "agent" && <AgentTab record={record} />}
        {activeTab === "fetch" && <FetchTab record={record} />}
        {activeTab === "trigger" && <TriggerTab record={record} />}
        {activeTab === "guide" && <GuideTab />}
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
