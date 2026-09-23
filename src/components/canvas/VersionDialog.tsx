import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { History, Loader2, RotateCcw, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  createBoardVersion,
  getBoardVersion,
  listBoardVersions,
  restoreBoardVersion,
} from "@/lib/versions.functions";

type Version = Awaited<ReturnType<typeof listBoardVersions>>[number];
type Detail = Awaited<ReturnType<typeof getBoardVersion>>;

function when(iso: string) {
  return new Date(iso).toLocaleString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Versionsverlauf eines Scopes: frühere Stände ansehen und wiederherstellen. */
export function VersionDialog({
  boardId,
  canEdit,
  onRestored,
}: {
  boardId: string;
  canEdit: boolean;
  onRestored: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [list, setList] = useState<Version[]>([]);
  const [loading, setLoading] = useState(false);
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setList(await listBoardVersions({ data: { boardId } }));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Verlauf nicht verfügbar");
    } finally {
      setLoading(false);
    }
  }, [boardId]);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  const save = async () => {
    setBusy(true);
    try {
      await createBoardVersion({ data: { boardId, label: label.trim() || undefined } });
      setLabel("");
      toast.success("Stand gesichert");
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Sichern fehlgeschlagen");
    } finally {
      setBusy(false);
    }
  };

  const show = async (id: string) => {
    setSelected(id);
    setDetail(null);
    try {
      setDetail(await getBoardVersion({ data: { versionId: id } }));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Stand nicht lesbar");
    }
  };

  const restore = async (id: string) => {
    setBusy(true);
    try {
      const result = await restoreBoardVersion({ data: { versionId: id } });
      toast.success(`Wiederhergestellt: ${result.nodes} Module, ${result.edges} Verbindungen`);
      setOpen(false);
      onRestored();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Wiederherstellen fehlgeschlagen");
    } finally {
      setBusy(false);
      setConfirmId(null);
    }
  };

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        className="gap-1.5"
        onClick={() => setOpen(true)}
        title="Versionsverlauf"
      >
        <History className="size-4" />
        <span className="hidden sm:inline">Verlauf</span>
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Versionsverlauf</DialogTitle>
            <DialogDescription>
              Frühere Stände dieses Scopes ansehen und bei Bedarf zurückholen. Vor jeder
              Wiederherstellung wird der aktuelle Stand automatisch gesichert.
            </DialogDescription>
          </DialogHeader>

          {canEdit && (
            <div className="flex gap-2">
              <Input
                value={label}
                placeholder="Beschreibung (optional), z. B. „vor Umbau“"
                onChange={(event) => setLabel(event.target.value)}
              />
              <Button onClick={() => void save()} disabled={busy} className="gap-1.5 shrink-0">
                {busy ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
                Stand sichern
              </Button>
            </div>
          )}

          <div className="max-h-[50vh] space-y-2 overflow-y-auto pr-1">
            {loading && <p className="text-sm text-muted-foreground">Wird geladen …</p>}
            {!loading && list.length === 0 && (
              <p className="text-sm text-muted-foreground">
                Noch keine Stände gesichert. Sichere den aktuellen Stand, um später darauf
                zurückgreifen zu können.
              </p>
            )}
            {list.map((version) => (
              <div key={version.id} className="rounded-lg border border-border/70 p-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">
                      {version.label || (version.kind === "automatisch" ? "Automatischer Stand" : "Gesicherter Stand")}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {when(version.createdAt)} · {version.author} · {version.nodes} Module ·{" "}
                      {version.edges} Verbindungen
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-1.5">
                    <Button variant="outline" size="sm" onClick={() => void show(version.id)}>
                      Ansehen
                    </Button>
                    {canEdit && (
                      <Button
                        size="sm"
                        className="gap-1.5"
                        disabled={busy}
                        onClick={() => setConfirmId(version.id)}
                      >
                        <RotateCcw className="size-3.5" />
                        Wiederherstellen
                      </Button>
                    )}
                  </div>
                </div>
                {selected === version.id && (
                  <div className="mt-2 rounded-md bg-secondary/60 p-2 text-xs">
                    {!detail ? (
                      "Wird geladen …"
                    ) : (
                      <ul className="space-y-0.5">
                        {detail.modules.slice(0, 12).map((module) => (
                          <li key={module.id} className="truncate">
                            · {module.title || "Ohne Titel"}{" "}
                            <span className="text-muted-foreground">({module.type})</span>
                          </li>
                        ))}
                        {detail.modules.length > 12 && (
                          <li className="text-muted-foreground">
                            … und {detail.modules.length - 12} weitere
                          </li>
                        )}
                      </ul>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmId !== null} onOpenChange={(value) => !value && setConfirmId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Diesen Stand wiederherstellen?</AlertDialogTitle>
            <AlertDialogDescription>
              Der Scope wird vollständig auf diesen Stand zurückgesetzt. Der jetzige Stand wird
              vorher automatisch gesichert und bleibt im Verlauf erhalten.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Abbrechen</AlertDialogCancel>
            <AlertDialogAction onClick={() => confirmId && void restore(confirmId)}>
              Wiederherstellen
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
