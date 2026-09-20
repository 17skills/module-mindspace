import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Copy, Link2, Trash2, UserPlus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { addMember, listMembers, removeMember } from "@/lib/share.functions";

type Member = { id: string; userId: string; role: string; email: string };

export function ShareDialog({
  boardId,
  open,
  onOpenChange,
}: {
  boardId: string;
  open: boolean;
  onOpenChange: (value: boolean) => void;
}) {
  const [token, setToken] = useState<string | null>(null);
  const [isPublic, setIsPublic] = useState(false);
  const [members, setMembers] = useState<Member[]>([]);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    let active = true;
    void (async () => {
      const { data } = await supabase
        .from("boards")
        .select("share_token,is_public")
        .eq("id", boardId)
        .maybeSingle();
      if (!active || !data) return;
      setToken(data.share_token);
      setIsPublic(data.is_public);
      try {
        setMembers(await listMembers({ data: { boardId } }));
      } catch {
        /* keine Eigentümerrechte */
      }
    })();
    return () => {
      active = false;
    };
  }, [boardId, open]);

  const link = token
    ? `${typeof window === "undefined" ? "" : window.location.origin}/share/${token}`
    : "";

  async function togglePublic(value: boolean) {
    setIsPublic(value);
    const { error } = await supabase.from("boards").update({ is_public: value }).eq("id", boardId);
    if (error) {
      setIsPublic(!value);
      toast.error(error.message);
    }
  }

  async function invite() {
    if (!email.trim()) return;
    setBusy(true);
    try {
      await addMember({ data: { boardId, email: email.trim() } });
      setMembers(await listMembers({ data: { boardId } }));
      setEmail("");
      toast.success("Mitglied hinzugefügt");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Einladen fehlgeschlagen");
    } finally {
      setBusy(false);
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
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Board teilen</DialogTitle>
          <DialogDescription>
            Gäste lesen das Board nur über den Link. Mitglieder arbeiten mit – aber nur auf diesem
            Board.
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
            <Switch checked={isPublic} onCheckedChange={(value) => void togglePublic(value)} />
          </div>
          {isPublic && link ? (
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
          ) : null}
        </section>

        <section className="rounded-lg border border-border/70 bg-card p-4 shadow-[var(--shadow-card)]">
          <p className="text-sm font-medium">Mitglieder</p>
          <p className="text-xs text-muted-foreground">
            Zugriff gilt ausschließlich für dieses Board.
          </p>
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
            <Button
              className="rounded-full"
              disabled={busy || !email.trim()}
              onClick={() => void invite()}
            >
              <UserPlus className="size-4" />
              Hinzufügen
            </Button>
          </div>
          <ul className="mt-3 space-y-1">
            {members.map((member) => (
              <li
                key={member.id}
                className="flex items-center justify-between rounded-md px-2 py-1.5 text-sm hover:bg-accent"
              >
                <span>{member.email}</span>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="rounded-full"
                      onClick={() => void drop(member.id)}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Zugriff entziehen</TooltipContent>
                </Tooltip>
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
