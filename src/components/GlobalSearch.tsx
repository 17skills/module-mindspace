import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Search } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { NODE_LABEL } from "@/components/canvas/board-context";

type Hit = {
  kind: "scope" | "modul" | "verbindung";
  id: string;
  boardId: string;
  title: string;
  excerpt: string;
  badge: string;
};

/** Sucht über alle eigenen und geteilten Scopes: Karten, Felder, Verbindungen, Texte. */
export function GlobalSearch({ trigger = true }: { trigger?: boolean }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [busy, setBusy] = useState(false);
  const runId = useRef(0);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((value) => !value);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    const query = term.trim();
    if (query.length < 2) {
      setHits([]);
      setBusy(false);
      return;
    }
    const id = ++runId.current;
    setBusy(true);
    const timer = setTimeout(() => {
      void (async () => {
        const safe = query.replace(/[%,()]/g, " ");
        const [boardRes, nodeRes, edgeRes, titleRes] = await Promise.all([
          supabase
            .from("boards")
            .select("id,title,description")
            .or(`title.ilike.%${safe}%,description.ilike.%${safe}%`)
            .limit(10),
          supabase
            .from("nodes")
            .select("id,board_id,type,title,content")
            .or(`title.ilike.%${safe}%,content.ilike.%${safe}%`)
            .limit(40),
          supabase
            .from("edges")
            .select("id,board_id,label,source_id")
            .ilike("label", `%${safe}%`)
            .limit(15),
          supabase.from("boards").select("id,title").limit(200),
        ]);
        if (id !== runId.current) return;
        const names = new Map(
          (titleRes.data ?? []).map((row) => [String(row.id), String(row.title ?? "")]),
        );
        const list: Hit[] = [];
        for (const row of boardRes.data ?? []) {
          list.push({
            kind: "scope",
            id: String(row.id),
            boardId: String(row.id),
            title: String(row.title ?? "Ohne Titel"),
            excerpt: String(row.description ?? ""),
            badge: "Scope",
          });
        }
        for (const row of nodeRes.data ?? []) {
          const type = String(row.type ?? "");
          list.push({
            kind: "modul",
            id: String(row.id),
            boardId: String(row.board_id),
            title: String(row.title ?? NODE_LABEL[type] ?? type),
            excerpt: String(row.content ?? "").slice(0, 160),
            badge: NODE_LABEL[type] ?? type,
          });
        }
        for (const row of edgeRes.data ?? []) {
          list.push({
            kind: "verbindung",
            id: String(row.source_id),
            boardId: String(row.board_id),
            title: String(row.label ?? ""),
            excerpt: "Beschriftung einer Verbindung",
            badge: "Verbindung",
          });
        }
        setHits(
          list.map((hit) => ({
            ...hit,
            excerpt:
              hit.kind === "scope"
                ? hit.excerpt
                : `${names.get(hit.boardId) ?? "Scope"} · ${hit.excerpt}`,
          })),
        );
        setBusy(false);
      })();
    }, 220);
    return () => clearTimeout(timer);
  }, [term]);

  const grouped = useMemo(
    () => ({
      scopes: hits.filter((hit) => hit.kind === "scope"),
      rest: hits.filter((hit) => hit.kind !== "scope"),
    }),
    [hits],
  );

  const go = (hit: Hit) => {
    setOpen(false);
    setTerm("");
    void navigate({
      to: "/board/$boardId",
      params: { boardId: hit.boardId },
      ...(hit.kind === "scope" ? {} : { search: { focus: hit.id } }),
    });
  };

  return (
    <>
      {trigger && (
        <Button
          variant="outline"
          size="sm"
          className="gap-2 text-muted-foreground"
          onClick={() => setOpen(true)}
        >
          <Search className="size-3.5" />
          <span className="hidden sm:inline">Suchen</span>
          <kbd className="hidden rounded bg-muted px-1.5 text-[10px] sm:inline">⌘K</kbd>
        </Button>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl gap-0 overflow-hidden p-0">
          <DialogTitle className="sr-only">Globale Suche</DialogTitle>
          <div className="flex items-center gap-2 border-b px-4">
            <Search className="size-4 shrink-0 text-muted-foreground" />
            <input
              autoFocus
              value={term}
              onChange={(event) => setTerm(event.target.value)}
              placeholder="Karten, Felder, Verbindungen und Texte in allen Scopes suchen …"
              className="h-12 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
          </div>
          <div className="max-h-[60vh] overflow-y-auto p-2">
            {term.trim().length < 2 && (
              <p className="px-3 py-8 text-center text-sm text-muted-foreground">
                Mindestens zwei Zeichen eingeben.
              </p>
            )}
            {term.trim().length >= 2 && !busy && hits.length === 0 && (
              <p className="px-3 py-8 text-center text-sm text-muted-foreground">
                Nichts gefunden.
              </p>
            )}
            {[
              { label: "Scopes", items: grouped.scopes },
              { label: "Inhalte", items: grouped.rest },
            ]
              .filter((group) => group.items.length > 0)
              .map((group) => (
                <div key={group.label} className="mb-2">
                  <p className="px-3 py-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                    {group.label}
                  </p>
                  {group.items.map((hit) => (
                    <button
                      key={`${hit.kind}-${hit.id}-${hit.boardId}`}
                      onClick={() => go(hit)}
                      className="flex w-full items-start gap-3 rounded-lg px-3 py-2 text-left transition hover:bg-accent"
                    >
                      <span className="mt-0.5 shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                        {hit.badge}
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium">
                          {hit.title || "Ohne Titel"}
                        </span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {hit.excerpt}
                        </span>
                      </span>
                    </button>
                  ))}
                </div>
              ))}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
