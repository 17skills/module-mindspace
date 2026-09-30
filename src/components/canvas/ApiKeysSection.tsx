import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Copy, KeyRound, ShieldOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { createApiKey, listApiKeys, revokeApiKey } from "@/lib/api-keys.functions";
import { useTranslation } from "@/lib/i18n";

type KeyRow = {
  id: string;
  name: string;
  prefix: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
};

/** Schlüssel, mit denen andere Systeme diesen Scope ohne Browser starten können. */
export function ApiKeysSection({ boardId, isOwner }: { boardId: string; isOwner: boolean }) {
  const { l } = useTranslation();
  const [keys, setKeys] = useState<KeyRow[]>([]);
  const [name, setName] = useState("");
  const [fresh, setFresh] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function reload() {
    try {
      setKeys((await listApiKeys({ data: { boardId } })) as KeyRow[]);
    } catch {
      setKeys([]);
    }
  }

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boardId]);

  async function create() {
    setBusy(true);
    try {
      const result = await createApiKey({ data: { boardId, name: name.trim() } });
      setFresh(result.secret);
      setName("");
      await reload();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : l("Anlegen fehlgeschlagen"));
    } finally {
      setBusy(false);
    }
  }

  const endpoint = `${typeof window === "undefined" ? "" : window.location.origin}/api/public/scopes/${boardId}/run`;

  return (
    <section className="mt-6 border-t border-border pt-4">
      <h3 className="flex items-center gap-2 text-sm font-medium">
         <KeyRound className="size-4" /> {l("Start durch andere Systeme")}
      </h3>
      <p className="mt-1 text-xs text-muted-foreground">
         {l("Mit einem Schlüssel kann ein anderes Programm diesen Scope starten, ohne dass jemand die Oberfläche öffnet. Jeder Durchlauf wird wie gewohnt festgehalten.")}
      </p>
      <code className="mt-2 block truncate rounded-md bg-muted px-2 py-1 text-xs">{endpoint}</code>

      {isOwner ? (
        <div className="mt-3 flex gap-2">
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Name, z. B. Warenwirtschaft"
             aria-label={l("Name des Schlüssels")}
          />
          <Button onClick={() => void create()} disabled={busy}>
             {l("Schlüssel erstellen")}
          </Button>
        </div>
      ) : null}

      {fresh ? (
        <div className="mt-3 rounded-md border border-border bg-muted/50 p-2">
          <p className="text-xs text-muted-foreground">
             {l("Nur jetzt sichtbar – bitte sicher ablegen:")}
          </p>
          <div className="mt-1 flex items-center gap-2">
            <code className="flex-1 truncate text-xs">{fresh}</code>
            <Button
              size="icon"
              variant="ghost"
               aria-label={l("Schlüssel kopieren")}
              onClick={() => {
                void navigator.clipboard.writeText(fresh);
                toast.success("Kopiert");
              }}
            >
              <Copy className="size-4" />
            </Button>
          </div>
        </div>
      ) : null}

      <ul className="mt-3 space-y-1">
        {keys.map((key) => (
          <li
            key={key.id}
            className="flex items-center justify-between rounded-md px-2 py-1.5 text-sm hover:bg-accent"
          >
            <span className="truncate">
              {key.name}{" "}
              <span className="text-xs text-muted-foreground">
                {key.prefix}… {key.revoked_at ? "· gesperrt" : key.last_used_at ? "· zuletzt genutzt" : ""}
              </span>
            </span>
            {isOwner && !key.revoked_at ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="rounded-full"
                    aria-label={`${key.name} sperren`}
                    onClick={async () => {
                      await revokeApiKey({ data: { boardId, keyId: key.id } });
                      await reload();
                    }}
                  >
                    <ShieldOff className="size-4" />
                  </Button>
                </TooltipTrigger>
                 <TooltipContent>{l("Schlüssel sperren")}</TooltipContent>
              </Tooltip>
            ) : null}
          </li>
        ))}
        {keys.length === 0 ? (
           <li className="px-2 py-1.5 text-sm text-muted-foreground">{l("Noch kein Schlüssel")}</li>
        ) : null}
      </ul>
    </section>
  );
}
