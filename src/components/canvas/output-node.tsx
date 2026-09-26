/**
 * Ergebnis-Karte: fester Ausgang eines Scopes.
 * Übernimmt das Ergebnis der verbundenen Karte als Momentaufnahme; Apps zeigen genau diese.
 */
import { memo, useEffect, useMemo, useState } from "react";
import { NodeResizer, Position, useStore, type NodeProps } from "@xyflow/react";
import { useBoard, type NodeRecord } from "./board-context";
import { SignalHandle } from "./nodes";
import { supabase } from "@/integrations/supabase/client";
import { OutputView } from "@/components/OutputView";
import { ARTIFACT_LABEL, artifactFrom, readOutput, sameArtifact } from "@/lib/output";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { createTestRun, runStats } from "@/lib/runs.functions";
import { retentionDays } from "@/lib/runs";
import { RunsDialog } from "./RunsDialog";

function ago(value: string) {
  const min = Math.round((Date.now() - new Date(value).getTime()) / 60_000);
  if (min < 1) return "gerade eben";
  if (min < 60) return `vor ${min} Min.`;
  const h = Math.round(min / 60);
  return h < 48 ? `vor ${h} Std.` : `vor ${Math.round(h / 24)} Tagen`;
}

/** Nur Zählwert und letzter Zeitpunkt – die Liste lädt erst im Dialog. */
function RunsFooter({ nodeId, metadata }: { nodeId: string; metadata: Record<string, unknown> | null }) {
  const stats = useServerFn(runStats);
  const test = useServerFn(createTestRun);
  const [info, setInfo] = useState<{ count: number; lastAt: string | null; seesAll: boolean } | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const refresh = () =>
    void stats({ data: { outputNodeId: nodeId } })
      .then(setInfo)
      .catch(() => setInfo(null));
  useEffect(refresh, [nodeId]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!info) return null;
  return (
    <div className="nodrag flex items-center gap-2 border-t px-3 py-1.5 text-[11px] text-muted-foreground">
      <span className="flex-1">
        {info.count} {info.count === 1 ? "Durchlauf" : "Durchläufe"}
        {info.lastAt ? ` · letzter ${ago(info.lastAt)}` : ""}
      </span>
      {info.seesAll ? (
        <button
          className="rounded-full px-2 py-0.5 hover:bg-muted hover:text-foreground disabled:opacity-50"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              const run = await test({ data: { outputNodeId: nodeId } });
              toast.success(run.status === "done" ? "Testdurchlauf abgelegt" : "Abgelegt – noch kein Ergebnis am Ausgang");
              refresh();
            } catch (err) {
              toast.error(err instanceof Error ? err.message : "Nicht abgelegt");
            } finally {
              setBusy(false);
            }
          }}
        >
          Testdurchlauf
        </button>
      ) : null}
      <button className="rounded-full bg-muted px-2 py-0.5 text-foreground hover:bg-muted/70" onClick={() => setOpen(true)}>
        Durchläufe ansehen
      </button>
      {open ? (
        <RunsDialog
          open={open}
          onOpenChange={(v) => {
            setOpen(v);
            if (!v) refresh();
          }}
          outputNodeId={nodeId}
          retention={retentionDays(metadata)}
        />
      ) : null}
    </div>
  );
}

/** Zuletzt verbundene Karte, die auf diesen Ausgang zeigt. */
function useUpstream(nodeId: string): NodeRecord | null {
  return useStore(
    (store) => {
      let found: NodeRecord | null = null;
      for (const edge of store.edges) {
        if (edge.target !== nodeId) continue;
        const record = (store.nodeLookup.get(edge.source)?.data as { record?: NodeRecord } | undefined)?.record;
        if (record) found = record;
      }
      return found;
    },
    (a, b) =>
      a === b ||
      (a !== null &&
        b !== null &&
        a.id === b.id &&
        a.content === b.content &&
        a.storage_path === b.storage_path &&
        a.source_url === b.source_url &&
        a.mime_type === b.mime_type &&
        a.title === b.title),
  );
}

export const OutputNode = memo(function OutputNode({ id, data, selected }: NodeProps) {
  const record = (data as unknown as { record: NodeRecord }).record;
  const { updateNode, deleteNode } = useBoard();
  const upstream = useUpstream(id);
  const stored = readOutput(record.metadata);

  const next = useMemo(() => artifactFrom(upstream), [upstream]);
  useEffect(() => {
    if (sameArtifact(next, stored)) return;
    updateNode(record.id, { metadata: { ...(record.metadata ?? {}), output: next } });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [next]);

  const path = upstream?.id === stored.sourceId ? upstream.storage_path : null;
  const [fileUrl, setFileUrl] = useState<string | null>(null);
  useEffect(() => {
    setFileUrl(null);
    if (!path) return;
    let alive = true;
    void supabase.storage
      .from("uploads")
      .createSignedUrl(path, 3600)
      .then(({ data: signed }) => alive && setFileUrl(signed?.signedUrl ?? null));
    return () => {
      alive = false;
    };
  }, [path]);

  return (
    <div
      className={`module-card flex h-full w-full flex-col overflow-hidden border bg-card ${
        selected ? "border-ring/60 shadow-[var(--shadow-float)]" : "border-border/70"
      }`}
      data-selected={Boolean(selected)}
    >
      <NodeResizer isVisible={Boolean(selected)} minWidth={260} minHeight={200} />
      <SignalHandle type="target" position={Position.Left} />

      <div className="module-heading flex items-center gap-2 border-b px-3 py-2">
        <span className="rounded-md bg-primary px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-primary-foreground">
          Ergebnis
        </span>
        <span className="line-clamp-1 flex-1 text-sm font-medium">
          {record.title || "Ergebnis"}
        </span>
        <span className="text-[10px] text-muted-foreground">{ARTIFACT_LABEL[stored.kind]}</span>
        <button
          className="nodrag flex size-6 items-center justify-center rounded-full text-xs text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
          onClick={() => deleteNode(record.id)}
          aria-label="Modul löschen"
        >
          ✕
        </button>
      </div>

      <div className="nowheel flex-1 overflow-auto px-3 py-2">
        <OutputView artifact={stored} fileUrl={fileUrl} compact />
      </div>
      {upstream ? (
        <p className="border-t px-3 py-1 text-[10px] text-muted-foreground">
          Aus: {upstream.title || "verbundener Karte"}
        </p>
      ) : null}
      <RunsFooter nodeId={record.id} metadata={record.metadata} />
    </div>
  );
});
