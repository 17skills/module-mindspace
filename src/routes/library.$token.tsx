import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { LibraryPreview } from "@/components/canvas/LibraryPreview";
import { NODE_LABEL } from "@/components/canvas/board-context";
import { copySharedEntry, getPublicLibraryEntry } from "@/lib/library.functions";
import { readPayload, summarize, type LibraryPayload } from "@/lib/library";
import { useAuth } from "@/hooks/useAuth";

export const Route = createFileRoute("/library/$token")({
  head: () => ({
    meta: [
      { title: "Geteiltes Modul – scopebuilder" },
      {
        name: "description",
        content: "Ein geteiltes Modul aus der Bibliothek ansehen und in die eigene Sammlung übernehmen.",
      },
      { property: "og:title", content: "Geteiltes Modul – scopebuilder" },
      {
        property: "og:description",
        content: "Ein geteiltes Modul aus der Bibliothek ansehen und in die eigene Sammlung übernehmen.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: SharedEntryPage,
  errorComponent: () => (
    <div className="flex min-h-screen items-center justify-center p-8 text-muted-foreground">
      Dieser Link ist nicht (mehr) freigegeben.
    </div>
  ),
  notFoundComponent: () => (
    <div className="flex min-h-screen items-center justify-center p-8 text-muted-foreground">
      Nicht gefunden.
    </div>
  ),
});

type Entry = {
  title: string;
  description: string | null;
  tags: string[] | null;
  scope: string;
  payload: LibraryPayload;
};

function SharedEntryPage() {
  const { token } = Route.useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [entry, setEntry] = useState<Entry | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void getPublicLibraryEntry({ data: { token } })
      .then((row) =>
        setEntry({
          title: row.title,
          description: row.description,
          tags: row.tags,
          scope: row.scope,
          payload: readPayload(row.payload),
        }),
      )
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : "Dieser Link ist nicht (mehr) freigegeben"),
      );
  }, [token]);

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center p-8 text-muted-foreground">
        {error}
      </div>
    );
  }

  if (!entry) {
    return <div className="flex min-h-screen items-center justify-center text-muted-foreground">…</div>;
  }

  const counts = [...summarize(entry.payload).entries()]
    .map(([type, count]) => `${count}× ${NODE_LABEL[type] ?? type}`)
    .join(", ");

  return (
    <div className="min-h-screen bg-canvas">
      <header className="flex h-14 items-center gap-2 border-b border-border/70 bg-card/90 px-4 backdrop-blur">
        <Button asChild size="icon" variant="ghost" className="size-9 rounded-lg">
          <Link to="/" aria-label="Zur Startseite">
            <ArrowLeft className="size-4" />
          </Link>
        </Button>
        <span className="font-display text-base font-semibold">Geteiltes Modul</span>
      </header>

      <main className="mx-auto max-w-3xl space-y-4 p-6">
        <div className="rounded-lg border border-border/70 bg-card p-5 shadow-[var(--shadow-card)]">
          <LibraryPreview payload={entry.payload} className="h-64" />
          <h1 className="mt-4 font-display text-2xl font-semibold">{entry.title}</h1>
          <p className="text-sm text-muted-foreground">{entry.description || "Ohne Beschreibung"}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {entry.payload.nodes.length} Module
            {entry.scope === "group" ? " · Gruppe" : " · Einzelmodul"}
            {counts ? ` · ${counts}` : ""}
          </p>
          {entry.tags?.length ? (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {entry.tags.map((tag) => (
                <span key={tag} className="rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground">
                  {tag}
                </span>
              ))}
            </div>
          ) : null}

          <div className="mt-5">
            {user ? (
              <Button
                className="rounded-full"
                disabled={busy}
                onClick={() => {
                  setBusy(true);
                  void copySharedEntry({ data: { token, id: null } })
                    .then(() => toast.success("In deine Bibliothek übernommen"))
                    .catch((err: unknown) =>
                      toast.error(err instanceof Error ? err.message : "Übernahme fehlgeschlagen"),
                    )
                    .finally(() => setBusy(false));
                }}
              >
                In meine Bibliothek übernehmen
              </Button>
            ) : (
              <Button className="rounded-full" onClick={() => void navigate({ to: "/auth" })}>
                Anmelden und übernehmen
              </Button>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
