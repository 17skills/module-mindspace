import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft, Check, Loader2, Lock, Plug, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { saveMcpServer, type McpServerInfoRow } from "@/lib/mcp-client.functions";
import { MCP_TEMPLATES, type McpTemplate } from "@/lib/mcp-templates";

type AuthKind = "none" | "bearer" | "header";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Wird nach erfolgreichem Handschlag mit dem neuen Server aufgerufen. */
  onConnected?: (server: McpServerInfoRow) => void;
};

/** Dialog, um direkt vom Scope aus eine externe Werkzeugquelle (MCP) zu verbinden. */
export function McpConnectDialog({ open, onOpenChange, onConnected }: Props) {
  const queryClient = useQueryClient();
  const [step, setStep] = useState<"catalog" | "form">("catalog");
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [authKind, setAuthKind] = useState<AuthKind>("none");
  const [headerName, setHeaderName] = useState("");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [template, setTemplate] = useState<McpTemplate | null>(null);

  function applyTemplate(entry: McpTemplate) {
    setTemplate(entry);
    setName(entry.name);
    setUrl(entry.url);
    setAuthKind(entry.authKind);
    setHeaderName(entry.headerName ?? "");
    setToken("");
    setStep("form");
  }

  function startCustom() {
    setTemplate(null);
    setName("");
    setUrl("");
    setAuthKind("bearer");
    setHeaderName("");
    setToken("");
    setStep("form");
  }

  function reset() {
    setStep("catalog");
    setTemplate(null);
    setName("");
    setUrl("");
    setAuthKind("none");
    setHeaderName("");
    setToken("");
  }

  function close() {
    reset();
    onOpenChange(false);
  }

  async function connect() {
    if (!name.trim() || !url.trim()) {
      toast.error("Bitte Name und Adresse angeben");
      return;
    }
    setBusy(true);
    try {
      const server = await saveMcpServer({
        data: {
          name: name.trim(),
          url: url.trim(),
          authKind,
          ...(authKind === "header" ? { headerName: headerName.trim() } : {}),
          ...(authKind === "none" ? {} : { token: token.trim() }),
        },
      });
      await queryClient.invalidateQueries({ queryKey: ["mcp-servers"] });
      toast.success(`${server.name} verbunden – ${server.tools.length} Werkzeuge gefunden`);
      onConnected?.(server);
      close();
    } catch (problem) {
      toast.error(problem instanceof Error ? problem.message : "Verbindung fehlgeschlagen");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (busy ? null : next ? onOpenChange(true) : close())}>
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader className="space-y-2">
          <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
            Werkzeugquelle
          </p>
          <DialogTitle className="flex items-center gap-2 text-xl">
            {step === "form" && template ? template.name : "Dienst verbinden"}
          </DialogTitle>
          <DialogDescription>
            {step === "catalog"
              ? "Wähle einen Dienst aus dem Katalog oder verbinde eine eigene Adresse."
              : "Adresse prüfen, Zugangsschlüssel eintragen – danach stehen die Werkzeuge im Scope bereit."}
          </DialogDescription>
        </DialogHeader>

        {step === "catalog" ? (
          <div className="grid gap-3 sm:grid-cols-2">
            {MCP_TEMPLATES.map((entry) => (
              <button
                key={entry.id}
                type="button"
                onClick={() => applyTemplate(entry)}
                className="group rounded-xl border bg-card p-4 text-left transition-colors hover:border-primary hover:bg-accent/40"
              >
                <div className="flex items-center gap-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted font-mono text-sm font-semibold text-foreground">
                    {entry.name.slice(0, 1)}
                  </span>
                  <span className="flex-1 font-medium">{entry.name}</span>
                  {entry.authKind !== "none" ? (
                    <Lock className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
                  ) : null}
                </div>
                <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{entry.summary}</p>
                <div className="mt-3 flex flex-wrap gap-1">
                  {entry.tools.slice(0, 3).map((tool) => (
                    <span
                      key={tool}
                      className="rounded-full border px-2 py-0.5 font-mono text-[10px] text-muted-foreground"
                    >
                      {tool}
                    </span>
                  ))}
                </div>
              </button>
            ))}

            <button
              type="button"
              onClick={startCustom}
              className="rounded-xl border border-dashed bg-muted/30 p-4 text-left transition-colors hover:border-primary hover:bg-accent/40"
            >
              <div className="flex items-center gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-background">
                  <Plug className="h-4 w-4" aria-hidden />
                </span>
                <span className="flex-1 font-medium">Eigener Server</span>
              </div>
              <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                Beliebiger MCP-Endpunkt deines Unternehmens oder eigener Werkzeuge.
              </p>
            </button>
          </div>
        ) : (
          <div className="grid gap-4">
            {template ? (
              <div className="rounded-xl border bg-muted/30 p-3 text-xs leading-relaxed text-muted-foreground">
                {template.summary}
                {template.urlHint ? <> {template.urlHint}</> : null}
                <div className="mt-2 flex flex-wrap gap-1">
                  {template.tools.map((tool) => (
                    <span
                      key={tool}
                      className="rounded-full border bg-background px-2 py-0.5 font-mono text-[10px]"
                    >
                      {tool}
                    </span>
                  ))}
                </div>
              </div>
            ) : null}

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label htmlFor="mcp-name">Name im Scope</Label>
                <Input
                  id="mcp-name"
                  value={name}
                  placeholder="z. B. Methocards"
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
              <div className="grid gap-1.5">
                <Label>Anmeldung</Label>
                <Select value={authKind} onValueChange={(next) => setAuthKind(next as AuthKind)}>
                  <SelectTrigger aria-label="Anmeldeart">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Keine</SelectItem>
                    <SelectItem value="bearer">Zugangsschlüssel (Bearer)</SelectItem>
                    <SelectItem value="header">Eigenes Kopffeld</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5 sm:col-span-2">
                <Label htmlFor="mcp-url">Adresse</Label>
                <Input
                  id="mcp-url"
                  value={url}
                  placeholder="https://example.com/mcp"
                  onChange={(e) => setUrl(e.target.value)}
                />
              </div>
              {authKind === "header" ? (
                <div className="grid gap-1.5">
                  <Label htmlFor="mcp-header">Feldname</Label>
                  <Input
                    id="mcp-header"
                    value={headerName}
                    placeholder="X-Api-Key"
                    onChange={(e) => setHeaderName(e.target.value)}
                  />
                </div>
              ) : null}
              {authKind !== "none" ? (
                <div className="grid gap-1.5 sm:col-span-2">
                  <Label htmlFor="mcp-token">Zugangsschlüssel</Label>
                  <Input
                    id="mcp-token"
                    type="password"
                    value={token}
                    autoComplete="off"
                    placeholder={template?.tokenHint ?? "Schlüssel einfügen"}
                    onChange={(e) => setToken(e.target.value)}
                  />
                  {template?.tokenHint ? (
                    <p className="text-xs text-muted-foreground">{template.tokenHint}</p>
                  ) : null}
                </div>
              ) : null}
            </div>

            <div className="flex items-start gap-2 rounded-xl border bg-card p-3 text-xs leading-relaxed text-muted-foreground">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <span>
                Nur verschlüsselte Adressen (https). Schlüssel werden verschlüsselt gespeichert, nie
                im Scope angezeigt und ausschließlich serverseitig verwendet.
              </span>
            </div>
          </div>
        )}

        <DialogFooter className="gap-2 sm:justify-between">
          {step === "form" ? (
            <Button variant="ghost" disabled={busy} onClick={() => setStep("catalog")}>
              <ArrowLeft className="mr-1.5 h-4 w-4" aria-hidden />
              Katalog
            </Button>
          ) : (
            <span className="hidden sm:block" />
          )}
          <div className="flex gap-2">
            <Button variant="ghost" disabled={busy} onClick={close}>
              Abbrechen
            </Button>
            {step === "form" ? (
              <Button disabled={busy} onClick={() => void connect()}>
                {busy ? (
                  <>
                    <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden />
                    Prüfe Verbindung …
                  </>
                ) : (
                  <>
                    <Check className="mr-1.5 h-4 w-4" aria-hidden />
                    Verbinden &amp; prüfen
                  </>
                )}
              </Button>
            ) : null}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
