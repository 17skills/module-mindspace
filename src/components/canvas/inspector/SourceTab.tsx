import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { youtubeId } from "@/lib/extract";
import { formatTime, type Segment } from "@/lib/segments";
import type { NodeRecord } from "@/components/canvas/board-context";
import { useTranslation } from "@/lib/i18n";

type Props = {
  record: NodeRecord;
  segments: Segment[];
  loading: boolean;
  selected: string[];
  onSelected: (ids: string[]) => void;
};

export function SourceTab({ record, segments, loading, selected, onSelected }: Props) {
  const { l } = useTranslation();
  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const [range, setRange] = useState("");
  const [seek, setSeek] = useState(0);
  const audioRef = useRef<HTMLAudioElement>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);

  const video = record.type === "youtube" ? youtubeId(record.source_url ?? "") : null;
  const isAudio = record.type === "audio" || record.type === "podcast";

  useEffect(() => {
    if (!isAudio) return;
    if (record.source_url && !record.storage_path) {
      setAudioUrl(record.source_url);
      return;
    }
    if (!record.storage_path) return;
    void supabase.storage
      .from("uploads")
      .createSignedUrl(record.storage_path, 3600)
      .then(({ data }) => setAudioUrl(data?.signedUrl ?? null));
  }, [isAudio, record.source_url, record.storage_path]);

  function toggle(id: string) {
    onSelected(selectedSet.has(id) ? selected.filter((s) => s !== id) : [...selected, id]);
  }

  function applyRange(value: string) {
    const ids = new Set<string>();
    for (const part of value.split(/[,;]/)) {
      const match = part.trim().match(/^(\d+)\s*(?:-|–|bis)?\s*(\d+)?$/);
      if (!match) continue;
      const from = Number(match[1]);
      const to = Number(match[2] ?? match[1]);
      for (let i = Math.min(from, to); i <= Math.max(from, to); i += 1) {
        const segment = segments[i - 1];
        if (segment) ids.add(segment.id);
      }
    }
    onSelected([...ids]);
  }

  function jumpTo(segment: Segment) {
    if (segment.start === undefined) return;
    if (video) setSeek(segment.start);
    if (audioRef.current) {
      audioRef.current.currentTime = segment.start;
      void audioRef.current.play();
    }
  }

  return (
    <div className="flex h-full flex-col">
      {video && (
        <div className="aspect-video w-full shrink-0 bg-black">
          <iframe
            key={seek}
            className="h-full w-full"
            src={`https://www.youtube.com/embed/${video}?start=${Math.floor(seek)}${seek ? "&autoplay=1" : ""}`}
            title={record.title ?? "Video"}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; picture-in-picture"
            allowFullScreen
          />
        </div>
      )}

      {isAudio && audioUrl && (
        <audio ref={audioRef} src={audioUrl} controls className="w-full shrink-0 px-3 py-2" />
      )}

      {!video && !isAudio && (record.metadata?.["thumbnail"] as string | undefined) && (
        <img
          src={record.metadata!["thumbnail"] as string}
          alt=""
          className="h-32 w-full shrink-0 object-cover"
        />
      )}

      <div className="flex shrink-0 items-center gap-2 border-b px-3 py-2">
        <Button size="sm" variant="secondary" onClick={() => onSelected(segments.map((s) => s.id))}>
          {l("Alle")}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => onSelected([])}>
          {l("Keine")}
        </Button>
        <Input
          value={range}
          placeholder="z. B. 3-7"
          onChange={(e) => setRange(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && applyRange(range)}
          className="h-8 w-28 text-xs"
        />
        <Button size="sm" variant="outline" onClick={() => applyRange(range)}>
          {l("Wählen")}
        </Button>
      </div>

      <div className="min-h-0 flex-1 space-y-2 overflow-auto p-3">
        {loading && <p className="text-xs text-muted-foreground">{l("Seiten werden geladen …")}</p>}
        {!loading && segments.length === 0 && (
          <p className="text-xs text-muted-foreground">
            {l("Dieses Modul enthält noch keinen auswählbaren Inhalt.")}
          </p>
        )}
        {segments.map((segment) => {
          const active = selectedSet.has(segment.id);
          return (
            <button
              key={segment.id}
              onClick={() => toggle(segment.id)}
              onDoubleClick={() => jumpTo(segment)}
              className={`flex w-full gap-3 rounded-xl border p-2 text-left transition ${
                active ? "border-primary bg-accent/50" : "hover:bg-secondary/60"
              }`}
            >
              <span
                className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border text-[10px] ${
                  active ? "border-primary bg-primary text-primary-foreground" : ""
                }`}
              >
                {active ? "✓" : ""}
              </span>
              {segment.thumb && (
                <img
                  src={segment.thumb}
                  alt=""
                  className="h-24 w-auto shrink-0 rounded border bg-card object-contain"
                />
              )}
              <span className="min-w-0 flex-1">
                <span className="block text-[11px] font-medium">
                  {segment.start === undefined ? segment.label : formatTime(segment.start)}
                </span>
                <span className="line-clamp-4 block text-[11px] text-muted-foreground">
                  {segment.text || "—"}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
