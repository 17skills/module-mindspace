import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
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

/** Kompakter Dialog, um direkt vom Scope aus einen externen MCP-Server zu verbinden. */
export function McpConnectDialog({ open, onOpenChange, onConnected }: Props) {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [authKind, setAuthKind] = useState<AuthKind>("none");
  const [headerName, setHeaderName] = useState("");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);

  function reset() {
    setName("");
    setUrl("");
    setAuthKind("none");
    setHeaderName("");
    setToken("");
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
      reset();
      onOpenChange(false);
    } catch (problem) {
      toast.error(problem instanceof Error ? problem.message : "Verbindung fehlgeschlagen");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (busy ? null : onOpenChange(next))}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>MCP-Server verbinden</DialogTitle>
          <DialogDescription>
            Nur verschlüsselte Adressen (https). Zugangsschlüssel werden verschlüsselt gespeichert
            und nie im Scope angezeigt.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="mcp-name">Name</Label>
            <Input
              id="mcp-name"
              value={name}
              placeholder="z. B. Methocards"
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="mcp-url">Adresse</Label>
            <Input
              id="mcp-url"
              value={url}
              placeholder="https://example.com/mcp"
              onChange={(e) => setUrl(e.target.value)}
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
            <div className="grid gap-1.5">
              <Label htmlFor="mcp-token">Schlüssel</Label>
              <Input
                id="mcp-token"
                type="password"
                value={token}
                autoComplete="off"
                onChange={(e) => setToken(e.target.value)}
              />
            </div>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="ghost" disabled={busy} onClick={() => onOpenChange(false)}>
            Abbrechen
          </Button>
          <Button disabled={busy} onClick={() => void connect()}>
            {busy ? "Prüfe Verbindung …" : "Verbinden & prüfen"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
