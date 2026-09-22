import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Plug, RefreshCw, ShieldCheck } from "lucide-react";
import {
  deleteMcpServer,
  listMcpServers,
  refreshMcpServer,
  saveMcpServer,
  type McpServerInfoRow,
} from "@/lib/mcp-client.functions";
import { MCP_TEMPLATES } from "@/lib/mcp-templates";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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

export const Route = createFileRoute("/_authenticated/konto/mcp")({
  head: () => ({
    meta: [
      { title: "MCP-Server — scopebuilder" },
      {
        name: "description",
        content:
          "Externe MCP-Server sicher verbinden und deren Werkzeuge als Module auf dem Scope nutzen.",
      },
      { property: "og:title", content: "MCP-Server — scopebuilder" },
      {
        property: "og:description",
        content: "Externe Werkzeugquellen verbinden, prüfen und wieder entziehen.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: McpPage,
});

type AuthKind = "none" | "bearer" | "header";

const EMPTY = {
  id: "",
  name: "",
  url: "",
  authKind: "none" as AuthKind,
  headerName: "",
  token: "",
};

function McpPage() {
  const client = useQueryClient();
  const servers = useQuery({ queryKey: ["mcp-servers"], queryFn: () => listMcpServers() });
  const [form, setForm] = useState({ ...EMPTY });
  const [remove, setRemove] = useState<McpServerInfoRow | null>(null);

  const refresh = () => void client.invalidateQueries({ queryKey: ["mcp-servers"] });

  const save = useMutation({
    mutationFn: () =>
      saveMcpServer({
        data: {
          ...(form.id ? { id: form.id } : {}),
          name: form.name.trim(),
          url: form.url.trim(),
          authKind: form.authKind,
          ...(form.headerName.trim() ? { headerName: form.headerName.trim() } : {}),
          ...(form.token.trim() ? { token: form.token.trim() } : {}),
        },
      }),
    onSuccess: (row) => {
      toast.success(`Verbunden: ${row.tools.length} Werkzeuge gefunden`);
      setForm({ ...EMPTY });
      refresh();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const recheck = useMutation({
    mutationFn: (id: string) => refreshMcpServer({ data: { id } }),
    onSuccess: (row) => {
      toast.success(`${row.name}: ${row.tools.length} Werkzeuge`);
      refresh();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const drop = useMutation({
    mutationFn: (id: string) => deleteMcpServer({ data: { id, confirm: true } }),
    onSuccess: () => {
      toast.success("MCP-Server entfernt");
      refresh();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <section className="space-y-6">
      <div className="rounded-2xl border bg-card p-6 shadow-[var(--shadow-card)]">
        <h2 className="font-display text-xl font-semibold text-brand-navy">MCP-Server</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Verbinde externe Werkzeugquellen wie methocards oder aixent. Nach dem Verbinden stehen
          ihre Werkzeuge als Modul „MCP-Werkzeug“ auf jedem Scope bereit. Zugangsschlüssel werden
          verschlüsselt gespeichert, Aufrufe laufen ausschließlich über den Server – nie aus dem
          Browser.
        </p>

        <div className="mt-5 flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-xs font-medium text-muted-foreground">Vorlagen:</span>
          {MCP_TEMPLATES.map((entry) => (
            <button
              key={entry.id}
              type="button"
              title={`${entry.summary} · ${entry.tools.join(", ")}`}
              onClick={() =>
                setForm({
                  id: "",
                  name: entry.name,
                  url: entry.url,
                  authKind: entry.authKind,
                  headerName: entry.headerName ?? "",
                  token: "",
                })
              }
              className="rounded-full border px-3 py-1 text-xs transition-colors hover:bg-muted"
            >
              {entry.name}
            </button>
          ))}
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <Input
            value={form.name}
            placeholder="Name, z. B. methocards"
            aria-label="Name"
            onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
          />
          <Input
            value={form.url}
            placeholder="https://… /mcp"
            aria-label="Adresse des MCP-Servers"
            onChange={(event) => setForm((prev) => ({ ...prev, url: event.target.value }))}
          />
          <Select
            value={form.authKind}
            onValueChange={(value) => setForm((prev) => ({ ...prev, authKind: value as AuthKind }))}
          >
            <SelectTrigger aria-label="Anmeldeart">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Ohne Anmeldung</SelectItem>
              <SelectItem value="bearer">Zugangsschlüssel (Bearer)</SelectItem>
              <SelectItem value="header">Eigenes Kopfzeilen-Feld</SelectItem>
            </SelectContent>
          </Select>
          {form.authKind === "header" ? (
            <Input
              value={form.headerName}
              placeholder="Feldname, z. B. x-api-key"
              aria-label="Feldname"
              onChange={(event) => setForm((prev) => ({ ...prev, headerName: event.target.value }))}
            />
          ) : (
            <span />
          )}
          {form.authKind !== "none" ? (
            <Input
              type="password"
              value={form.token}
              placeholder={form.id ? "Leer lassen, um den Schlüssel zu behalten" : "Zugangsschlüssel"}
              aria-label="Zugangsschlüssel"
              autoComplete="off"
              onChange={(event) => setForm((prev) => ({ ...prev, token: event.target.value }))}
            />
          ) : null}
        </div>

        <div className="mt-4 flex items-center gap-2">
          <Button
            disabled={!form.name.trim() || !form.url.trim() || save.isPending}
            onClick={() => save.mutate()}
          >
            <Plug className="mr-1.5 h-4 w-4" aria-hidden="true" />
            {save.isPending ? "Verbinde …" : form.id ? "Änderung sichern" : "Verbinden & prüfen"}
          </Button>
          {form.id ? (
            <Button variant="ghost" onClick={() => setForm({ ...EMPTY })}>
              Abbrechen
            </Button>
          ) : null}
          <span className="text-xs text-muted-foreground">
            Nur öffentliche https-Adressen; beim Verbinden werden die Werkzeuge gelesen.
          </span>
        </div>
      </div>

      <ul className="space-y-3">
        {(servers.data ?? []).map((row) => (
          <li key={row.id} className="rounded-xl border bg-card p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="font-medium">{row.name}</p>
                <p className="text-xs text-muted-foreground">
                  {row.url}
                  {row.serverName ? ` · ${row.serverName}` : ""}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant={row.lastError ? "destructive" : "default"}>
                  {row.lastError ? "Fehler" : `${row.tools.length} Werkzeuge`}
                </Badge>
                {row.hasToken ? (
                  <Badge variant="secondary" className="gap-1">
                    <ShieldCheck className="h-3 w-3" aria-hidden="true" />
                    geschützt
                  </Badge>
                ) : null}
              </div>
            </div>

            {row.lastError ? (
              <p className="mt-2 text-xs text-destructive">{row.lastError}</p>
            ) : (
              <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">
                {row.tools.map((tool) => tool.title || tool.name).join(" · ") || "Keine Werkzeuge gemeldet"}
              </p>
            )}

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={recheck.isPending}
                onClick={() => recheck.mutate(row.id)}
              >
                <RefreshCw className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                Prüfen & Werkzeuge aktualisieren
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  setForm({
                    id: row.id,
                    name: row.name,
                    url: row.url,
                    authKind: row.authKind,
                    headerName: row.headerName ?? "",
                    token: "",
                  })
                }
              >
                Bearbeiten
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="text-destructive hover:text-destructive"
                onClick={() => setRemove(row)}
              >
                Entfernen
              </Button>
              {row.lastCheckAt ? (
                <span className="text-[11px] text-muted-foreground">
                  zuletzt geprüft am {new Date(row.lastCheckAt).toLocaleString("de-DE")}
                </span>
              ) : null}
            </div>
          </li>
        ))}
        {servers.data && servers.data.length === 0 ? (
          <li className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
            Noch kein MCP-Server verbunden.
          </li>
        ) : null}
      </ul>

      <AlertDialog open={remove !== null} onOpenChange={(open) => (open ? null : setRemove(null))}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{remove?.name} entfernen?</AlertDialogTitle>
            <AlertDialogDescription>
              Der Zugang wird samt Schlüssel gelöscht. Module auf deinen Scopes, die diesen Server
              nutzen, können danach nicht mehr ausgeführt werden. Der Vorgang wird protokolliert.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Abbrechen</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (remove) drop.mutate(remove.id);
                setRemove(null);
              }}
            >
              Endgültig entfernen
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
