import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Lock, MessageSquare, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ASSIGNABLE_ROLES, ROLE_LABEL, canCommentRole, type AccessRole } from "@/lib/permissions";
import {
  addNodeComment,
  deleteNodeComment,
  listNodeAccess,
  listNodeComments,
  setNodeAccess,
} from "@/lib/permissions.functions";

type Rule = {
  id: string;
  subjectType: "default" | "user" | "team";
  subjectId: string | null;
  role: AccessRole;
  label: string;
};
type Access = {
  canManage: boolean;
  myRole: AccessRole;
  members: { userId: string; name: string }[];
  teams: { id: string; name: string }[];
  rules: Rule[];
};
type Comment = {
  id: string;
  body: string;
  createdAt: string;
  author: string;
  mine: boolean;
};

/** Rechte und Kommentare für ein einzelnes Modul oder Hintergrundfeld. */
export function NodeAccessDialog({
  boardId,
  nodeId,
  nodeTitle,
  isFrame,
  open,
  onOpenChange,
  onChanged,
}: {
  boardId: string;
  nodeId: string;
  nodeTitle: string;
  isFrame: boolean;
  open: boolean;
  onOpenChange: (value: boolean) => void;
  onChanged?: () => void;
}) {
  const [access, setAccess] = useState<Access | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [commentRole, setCommentRole] = useState<AccessRole | null>(null);
  const [subject, setSubject] = useState<string>("default");
  const [role, setRole] = useState<Exclude<AccessRole, "owner">>("viewer");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  async function reload() {
    try {
      setAccess((await listNodeAccess({ data: { boardId, nodeId } })) as Access);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Rechte nicht lesbar");
    }
    try {
      const result = await listNodeComments({ data: { boardId, nodeId } });
      setComments(result.comments as Comment[]);
      setCommentRole(result.role as AccessRole);
    } catch {
      setComments([]);
    }
  }

  useEffect(() => {
    if (!open) return;
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, boardId, nodeId]);

  async function save(
    subjectType: "default" | "user" | "team",
    subjectId: string | null,
    next: Exclude<AccessRole, "owner"> | "none",
  ) {
    setBusy(true);
    try {
      await setNodeAccess({ data: { boardId, nodeId, subjectType, subjectId, role: next } });
      await reload();
      onChanged?.();
      toast.success("Rechte aktualisiert");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Änderung fehlgeschlagen");
    } finally {
      setBusy(false);
    }
  }

  async function submitComment() {
    const body = text.trim();
    if (!body) return;
    setBusy(true);
    try {
      await addNodeComment({ data: { boardId, nodeId, body } });
      setText("");
      await reload();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Kommentar fehlgeschlagen");
    } finally {
      setBusy(false);
    }
  }

  const [kind, id] = subject === "default" ? ["default", null] : subject.split(":");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Lock className="size-4" /> Rechte · {nodeTitle || "Modul"}
          </DialogTitle>
          <DialogDescription>
            {isFrame
              ? "Diese Rechte gelten für das Hintergrundfeld und alles, was darin liegt."
              : "Lege fest, wer dieses Modul ansehen, kommentieren oder bearbeiten darf."}{" "}
            Mehr als im Scope selbst ist nie möglich.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <section className="space-y-3">
            {access?.rules.length ? (
              <ul className="space-y-2">
                {access.rules.map((rule) => (
                  <li
                    key={rule.id}
                    className="flex items-center gap-2 rounded-lg border border-border/70 px-3 py-2"
                  >
                    <span className="flex-1 truncate text-sm">{rule.label}</span>
                    {access.canManage ? (
                      <Select
                        value={rule.role}
                        onValueChange={(value) =>
                          void save(
                            rule.subjectType,
                            rule.subjectId,
                            value as Exclude<AccessRole, "owner">,
                          )
                        }
                      >
                        <SelectTrigger className="h-8 w-40">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {ASSIGNABLE_ROLES.map((item) => (
                            <SelectItem key={item} value={item}>
                              {ROLE_LABEL[item]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <span className="text-xs text-muted-foreground">{ROLE_LABEL[rule.role]}</span>
                    )}
                    {access.canManage ? (
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label="Regel entfernen"
                        disabled={busy}
                        onClick={() => void save(rule.subjectType, rule.subjectId, "none")}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">
                Keine eigene Regel – es gelten die Rechte des ganzen Scopes.
              </p>
            )}

            {access?.canManage ? (
              <div className="flex flex-wrap items-end gap-2 rounded-lg bg-muted/40 p-3">
                <div className="min-w-48 flex-1">
                  <Label className="text-xs">Für wen</Label>
                  <Select value={subject} onValueChange={setSubject}>
                    <SelectTrigger className="h-9">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="default">Alle anderen Beteiligten</SelectItem>
                      {access.members.map((member) => (
                        <SelectItem key={member.userId} value={`user:${member.userId}`}>
                          {member.name}
                        </SelectItem>
                      ))}
                      {access.teams.map((team) => (
                        <SelectItem key={team.id} value={`team:${team.id}`}>
                          Team · {team.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="w-40">
                  <Label className="text-xs">Darf</Label>
                  <Select
                    value={role}
                    onValueChange={(value) => setRole(value as Exclude<AccessRole, "owner">)}
                  >
                    <SelectTrigger className="h-9">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ASSIGNABLE_ROLES.map((item) => (
                        <SelectItem key={item} value={item}>
                          {ROLE_LABEL[item]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Button
                  className="h-9"
                  disabled={busy}
                  onClick={() =>
                    void save(kind as "default" | "user" | "team", id ?? null, role)
                  }
                >
                  Festlegen
                </Button>
              </div>
            ) : null}
          </section>

          <section className="space-y-3 border-t pt-4">
            <p className="flex items-center gap-2 text-sm font-medium">
              <MessageSquare className="size-4" /> Kommentare
            </p>
            <ul className="max-h-48 space-y-2 overflow-y-auto">
              {comments.length ? (
                comments.map((comment) => (
                  <li key={comment.id} className="rounded-lg border border-border/70 px-3 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold">{comment.author}</span>
                      <span className="text-[11px] text-muted-foreground">
                        {new Date(comment.createdAt).toLocaleString("de-DE")}
                      </span>
                      {comment.mine ? (
                        <Button
                          size="icon"
                          variant="ghost"
                          className="size-6"
                          aria-label="Kommentar löschen"
                          onClick={async () => {
                            await deleteNodeComment({ data: { commentId: comment.id } });
                            await reload();
                          }}
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      ) : null}
                    </div>
                    <p className="mt-1 whitespace-pre-wrap text-sm">{comment.body}</p>
                  </li>
                ))
              ) : (
                <li className="text-sm text-muted-foreground">Noch keine Kommentare.</li>
              )}
            </ul>
            {canCommentRole(commentRole) ? (
              <div className="flex gap-2">
                <Input
                  value={text}
                  placeholder="Kommentar schreiben …"
                  onChange={(event) => setText(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") void submitComment();
                  }}
                />
                <Button disabled={busy || !text.trim()} onClick={() => void submitComment()}>
                  Senden
                </Button>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                Zum Kommentieren brauchst du mindestens das Recht „Kommentieren“.
              </p>
            )}
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}
