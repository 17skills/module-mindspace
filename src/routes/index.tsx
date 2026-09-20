import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Canvas Spark – deine Wissens-Boards" },
      {
        name: "description",
        content:
          "Sammle YouTube-Videos, Podcasts, PDFs und Notizen auf einem Canvas, verbinde sie und arbeite per Chat mit ihnen.",
      },
      { property: "og:title", content: "Canvas Spark – deine Wissens-Boards" },
      {
        property: "og:description",
        content:
          "Ein Canvas für Videos, Podcasts, Dokumente und KI-Chat – alles verbunden an einem Ort.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: LibraryPage,
});

function LibraryPage() {
  const { user, loading, signOut } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!loading && !user) void navigate({ to: "/auth" });
  }, [loading, user, navigate]);

  const boards = useQuery({
    queryKey: ["boards", user?.id],
    enabled: Boolean(user),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("boards")
        .select("id,title,description,updated_at")
        .order("updated_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const createBoard = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase
        .from("boards")
        .insert({ user_id: user!.id, title: "Neues Board" })
        .select("id")
        .single();
      if (error) throw error;
      return data.id as string;
    },
    onSuccess: (id) => navigate({ to: "/board/$boardId", params: { boardId: id } }),
    onError: (error) => toast.error(error.message),
  });

  const deleteBoard = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("boards").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["boards"] }),
    onError: (error) => toast.error(error.message),
  });

  if (loading || !user) {
    return <div className="flex min-h-screen items-center justify-center text-muted-foreground">…</div>;
  }

  return (
    <main className="min-h-screen bg-background">
      <header className="border-b bg-card/70 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-brand-navy text-sm text-brand-navy-foreground">
              ✦
            </span>
            <span className="font-display text-lg font-semibold tracking-tight text-brand-navy">
              Canvas Spark
            </span>
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden text-sm text-muted-foreground sm:inline">{user.email}</span>
            <Button variant="ghost" size="sm" onClick={() => void signOut()}>
              Abmelden
            </Button>
          </div>
        </div>
      </header>

      <section className="mx-auto max-w-5xl px-6 py-12">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl font-semibold">Deine Boards</h1>
            <p className="mt-1 text-muted-foreground">
              Ein Board pro Thema: Videos, Podcasts, Dokumente, Notizen und Chat.
            </p>
          </div>
          <Button onClick={() => createBoard.mutate()} disabled={createBoard.isPending}>
            Neues Board
          </Button>
        </div>

        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {boards.data?.map((board) => (
            <div
              key={board.id}
              className="group rounded-2xl border bg-card p-5 shadow-[var(--shadow-card)] transition hover:-translate-y-0.5 hover:shadow-[var(--shadow-float)]"
            >
              <Link
                to="/board/$boardId"
                params={{ boardId: board.id }}
                className="block"
              >
                <h2 className="font-display text-lg font-semibold">{board.title}</h2>
                <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                  {board.description || "Ohne Beschreibung"}
                </p>
                <p className="mt-4 text-xs text-muted-foreground">
                  Zuletzt geändert {new Date(board.updated_at).toLocaleDateString("de-DE")}
                </p>
              </Link>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <button className="mt-3 text-xs text-muted-foreground opacity-0 transition group-hover:opacity-100 hover:text-destructive">
                    Löschen
                  </button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Board löschen?</AlertDialogTitle>
                    <AlertDialogDescription>
                      Alle Module, Verbindungen und Chats dieses Boards werden entfernt.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Abbrechen</AlertDialogCancel>
                    <AlertDialogAction onClick={() => deleteBoard.mutate(board.id)}>
                      Löschen
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          ))}

          {boards.data?.length === 0 && (
            <div className="col-span-full rounded-2xl border border-dashed p-12 text-center text-muted-foreground">
              Noch kein Board. Lege dein erstes an und ziehe Inhalte darauf.
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
