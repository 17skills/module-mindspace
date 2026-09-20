import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { pdfSegments, storedSegments, textSegments, type Segment } from "@/lib/segments";
import type { NodeRecord } from "@/components/canvas/board-context";

/** Selectable pieces of a module: stored segments, rendered PDF pages, or text blocks. */
export function useSegments(record: NodeRecord, onStore: (segments: Segment[]) => void) {
  const [segments, setSegments] = useState<Segment[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let active = true;
    const stored = storedSegments(record.metadata);
    if (stored) {
      setSegments(stored);
      return;
    }

    const isPdf =
      record.mime_type === "application/pdf" || /\.pdf$/i.test(record.title ?? "");

    if (isPdf && record.storage_path) {
      setLoading(true);
      void (async () => {
        try {
          const { data, error } = await supabase.storage
            .from("uploads")
            .download(record.storage_path!);
          if (error || !data) throw error ?? new Error("Datei nicht gefunden");
          const pages = await pdfSegments(data);
          if (!active) return;
          setSegments(pages);
          onStore(pages);
        } catch {
          if (active) setSegments(textSegments(record.content ?? ""));
        } finally {
          if (active) setLoading(false);
        }
      })();
      return () => {
        active = false;
      };
    }

    setSegments(textSegments(record.content ?? ""));
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [record.id, record.content, record.storage_path]);

  return { segments, loading };
}
