import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Copy, Link2, RefreshCw, ShieldOff, Trash2, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  addMember,
  getShareSettings,
  listMembers,
  removeMember,
  revokeShare,
  rotateShareToken,
  setMemberRole,
  updateShareSettings,
} from "@/lib/share.functions";
import { shareLink } from "@/lib/share-link";

type Member = { id: string; userId: string; role: string; email: string };
type ShareState = {
  token: string | null;
  isPublic: boolean;
  expiresAt: string | null;
  revokedAt: string | null;
  hasPassword: boolean;
  lastUsedAt: string | null;
};

const EXPIRY_OPTIONS = [
  { value: 0, label: "Kein Ablauf" },
  { value: 1, label: "1 Tag" },
  { value: 7, label: "7 Tage" },
  { value: 30, label: "30 Tage" },
  { value: 90, label: "90 Tage" },
];

export function ShareDialog({
  boardId,
  open,
  onOpenChange,
}: {
  boardId: string;
  open: boolean;
  onOpenChange: (value: boolean) => void;
}) {
  const [share, setShare] = useState<ShareState | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [myRole, setMyRole] = useState<string>("viewer");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"viewer" | "editor">("editor");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  const isOwner = myRole === "owner";

  async function reload() {
    try {
      const result = await listMembers({ data: { boardId } });
      setMyRole(result.role);
      setMembers(result.members);
    } catch {
      /* kein Zugriff */
    }
    try {
      setShare(await getShareSettings({ data: { boardId } }));
    } catch {
      setShare(null);
    }
  }

  useEffect(() => {
    if (!open) return;
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boardId, open]);

  const link = share?.token ? shareLink(`/share/${share.token}`) : "";
  const expired = share?.expiresAt ? new Date(share.expiresAt).getTime() < Date.now() : false;
  const active = Boolean(share?.isPublic) && !share?.revokedAt && !expired;

  async function patch(input: {
    boardId: string;
    isPublic?: boolean;
    expiresInDays?: number | null;
    password?: string | null;
  }) {
    setBusy(true);
    try {
      await updateShareSettings({ data: input });
      await reload();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Änderung fehlgeschlagen");
    } finally {
      setBusy(false);
    }
  }

  async function invite() {
    setBusy(true);
    try {
      await addMember({ data: { boardId, email: email.trim(), role } });
      setEmail("");
      await reload();
      toast.success("Mitglied hinzugefügt");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Einladen fehlgeschlagen");
    } finally {
      setBusy(false);
    }
  }

  async function changeRole(memberId: string, next: "viewer" | "editor") {
    setMembers((current) => current.map((m) => (m.id === memberId ? { ...m, role: next } : m)));
    try {
      await setMemberRole({ data: { boardId, memberId, role: next } });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Rechte konnten nicht geändert werden");
      await reload();
    }
  }

  async function drop(memberId: string) {
    try {
      await removeMember({ data: { boardId, memberId } });
      setMembers((current) => current.filter((m) => m.id !== memberId));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Entfernen fehlgeschlagen");
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Scope teilen</DialogTitle>
          <DialogDescription>
            Gäste lesen den Scope nur über den Link. Eingeladene Personen lesen mit oder arbeiten
            mit – je nach Recht, und immer nur in diesem Scope.
          </DialogDescription>
        </DialogHeader>

        <section className="rounded-lg border border-border/70 bg-card p-4 shadow-[var(--shadow-card)]">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <Link2 className="size-4 text-muted-foreground" />
              <div>
                <p className="text-sm font-medium">Link für Gäste</p>
                <p className="text-xs text-muted-foreground">Nur lesen, keine Anmeldung nötig</p>
              </div>
            </div>
            <Switch
              checked={active}
              disabled={!isOwner || busy}
              onCheckedChange={(value) => void patch({ boardId, isPublic: value })}
            />
          </div>

          {active && link ? (
            <>
              <div className="mt-3 flex items-center gap-2">
                <Input readOnly value={link} className="rounded-xl text-xs" />
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="rounded-full"
                      onClick={() => {
                        void navigator.clipboard.writeText(link);
                        toast.success("Link kopiert");
                      }}
                    >
                      <Copy className="size-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Link kopieren</TooltipContent>
                </Tooltip>
              </div>

              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <div>
                  <Label htmlFor="share-expiry" className="text-xs">
                    Gültig
                  </Label>
                  <select
                    id="share-expiry"
                    disabled={!isOwner}
                    value={share?.expiresAt ? "custom" : "0"}
                    onChange={(event) =>
                      void patch({ boardId, expiresInDays: Number(event.target.value) })
                    }
                    className="mt-1 h-9 w-full rounded-xl border border-border bg-background px-2 text-sm"
                  >
                    {share?.expiresAt ? (
                      <option value="custom">
                        bis {new Date(share.expiresAt).toLocaleDateString("de-DE")}
                      </option>
                    ) : null}
                    {EXPIRY_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <Label htmlFor="share-password" className="text-xs">
                    Passwortschutz {share?.hasPassword ? "(aktiv)" : "(optional)"}
                  </Label>
                  <div className="mt-1 flex gap-2">
                    <Input
                      id="share-password"
                      type="password"
                      value={password}
                      disabled={!isOwner}
                      placeholder="mind. 6 Zeichen"
                      onChange={(event) => setPassword(event.target.value)}
                      className="rounded-xl text-xs"
                    />
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={!isOwner || busy || (!password && !share?.hasPassword)}
                      onClick={() => {
                        const next = password.trim();
                        void patch({ boardId, password: next ? next : null });
                        setPassword("");
                      }}
                    >
                      {password.trim() ? "Setzen" : "Entfernen"}
                    </Button>
                  </div>
                </div>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!isOwner || busy}
                  onClick={() =>
                    void (async () => {
                      await rotateShareToken({ data: { boardId } });
                      await reload();
                      toast.success("Neuer Link erzeugt – der alte ist ungültig");
                    })()
                  }
                >
                  <RefreshCw className="mr-1.5 size-4" aria-hidden="true" />
                  Neuer Link
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!isOwner || busy}
                  onClick={() =>
                    void (async () => {
                      await revokeShare({ data: { boardId } });
                      await reload();
                      toast.success("Link widerrufen");
                    })()
                  }
                >
                  <ShieldOff className="mr-1.5 size-4" aria-hidden="true" />
                  Widerrufen
                </Button>
                {share?.lastUsedAt ? (
                  <span className="text-xs text-muted-foreground">
                    Zuletzt geöffnet: {new Date(share.lastUsedAt).toLocaleString("de-DE")}
                  </span>
                ) : null}
              </div>
            </>
          ) : share?.revokedAt || expired ? (
            <p className="mt-3 text-xs text-muted-foreground">
              Der Link ist {expired ? "abgelaufen" : "widerrufen"}. Schalte die Freigabe wieder ein,
              um einen gültigen Link zu erhalten.
            </p>
          ) : null}
        </section>

        <section className="rounded-lg border border-border/70 bg-card p-4 shadow-[var(--shadow-card)]">
          <p className="text-sm font-medium">Mitglieder</p>
          <p className="text-xs text-muted-foreground">
            Zugriff gilt ausschließlich für diesen Scope. Rollen ändern dürfen nur Inhaber.
          </p>

          {isOwner ? (
            <div className="mt-3 flex items-center gap-2">
              <Input
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="E-Mail-Adresse"
                className="rounded-xl"
                onKeyDown={(event) => {
                  if (event.key === "Enter") void invite();
                }}
              />
              <select
                value={role}
                onChange={(event) => setRole(event.target.value as "viewer" | "editor")}
                className="h-9 rounded-xl border border-border bg-background px-2 text-sm"
                aria-label="Rolle"
              >
                <option value="viewer">Lesen</option>
                <option value="editor">Bearbeiten</option>
              </select>
              <Button
                className="rounded-full"
                disabled={busy || !email.trim()}
                onClick={() => void invite()}
              >
                <UserPlus className="size-4" />
                Hinzufügen
              </Button>
            </div>
          ) : null}

          <ul className="mt-3 space-y-1">
            {members.map((member) => (
              <li
                key={member.id}
                className="flex items-center justify-between rounded-md px-2 py-1.5 text-sm hover:bg-accent"
              >
                <span className="truncate">{member.email}</span>
                {isOwner ? (
                  <>
                    <select
                      value={member.role === "viewer" ? "viewer" : "editor"}
                      onChange={(event) =>
                        void changeRole(member.id, event.target.value as "viewer" | "editor")
                      }
                      aria-label={`Rolle von ${member.email}`}
                      className="ml-auto mr-1 h-8 rounded-lg border border-border bg-background px-2 text-xs"
                    >
                      <option value="viewer">Lesen</option>
                      <option value="editor">Bearbeiten</option>
                    </select>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="rounded-full"
                          aria-label={`${member.email} entfernen`}
                          onClick={() => void drop(member.id)}
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Zugriff entziehen</TooltipContent>
                    </Tooltip>
                  </>
                ) : (
                  <span className="ml-auto text-xs text-muted-foreground">
                    {member.role === "viewer" ? "Lesen" : "Bearbeiten"}
                  </span>
                )}
              </li>
            ))}
            {members.length === 0 ? (
              <li className="px-2 py-1.5 text-sm text-muted-foreground">Noch keine Mitglieder</li>
            ) : null}
          </ul>
        </section>
      </DialogContent>
    </Dialog>
  );
}
