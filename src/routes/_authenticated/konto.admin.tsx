import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { ShieldCheck, Trash2 } from "lucide-react";
import {
  adminListAuditLog,
  adminListUsers,
  adminPurgeAuditLog,
  adminSetBlocked,
  adminSetRole,
} from "@/lib/admin.functions";
import { adminCreateUser, adminUsageSummary } from "@/lib/admin-users.functions";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const Route = createFileRoute("/_authenticated/konto/admin")({
  component: AdminPage,
});

const PAGE_SIZE = 25;

function AdminPage() {
  const client = useQueryClient();
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [offset, setOffset] = useState(0);
  const users = useQuery({
    queryKey: ["admin-users", query, offset],
    queryFn: () => adminListUsers({ data: { search: query, limit: PAGE_SIZE, offset } }),
  });
  const log = useQuery({ queryKey: ["admin-audit"], queryFn: () => adminListAuditLog() });
  const usage = useQuery({ queryKey: ["admin-usage"], queryFn: () => adminUsageSummary({ data: { days: 30 } }) });
  const total = users.data?.total ?? 0;
  const [filter, setFilter] = useState<"all" | "admin" | "blocked" | "deletion">("all");
  const [newEmail, setNewEmail] = useState("");
  const [newName, setNewName] = useState("");
  const [newPassword, setNewPassword] = useState("");

  const refresh = () => {
    void client.invalidateQueries({ queryKey: ["admin-users"] });
    void client.invalidateQueries({ queryKey: ["admin-audit"] });
  };

  const role = useMutation({
    mutationFn: (input: { userId: string; isAdmin: boolean }) => adminSetRole({ data: input }),
    onSuccess: refresh,
    onError: (error: Error) => toast.error(error.message),
  });

  const blocked = useMutation({
    mutationFn: (input: { userId: string; blocked: boolean }) => adminSetBlocked({ data: input }),
    onSuccess: refresh,
    onError: (error: Error) => toast.error(error.message),
  });

  const create = useMutation({
    mutationFn: () =>
      adminCreateUser({
        data: { email: newEmail.trim(), displayName: newName.trim(), password: newPassword },
      }),
    onSuccess: () => {
      toast.success("Konto angelegt");
      setNewEmail("");
      setNewName("");
      setNewPassword("");
      refresh();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const purge = useMutation({
    mutationFn: () => adminPurgeAuditLog(),
    onSuccess: () => {
      toast.success("Alte Protokolleinträge entfernt");
      refresh();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  if (users.isError) {
    return (
      <p className="rounded-2xl border bg-card p-6 text-sm text-muted-foreground">
        Dieser Bereich ist Administratoren vorbehalten.
      </p>
    );
  }

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border bg-card p-6 shadow-[var(--shadow-card)]">
        <h2 className="font-display text-xl font-semibold text-brand-navy">Konten</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Gesperrte Konten werden beim nächsten Seitenaufruf abgemeldet.
        </p>
        <form
          className="mt-4 flex max-w-md items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            setOffset(0);
            setQuery(search.trim());
          }}
        >
          <Input
            value={search}
            aria-label="Konten suchen"
            placeholder="Nach E-Mail oder Name suchen"
            onChange={(event) => setSearch(event.target.value)}
          />
          <Button type="submit" variant="outline" size="sm">
            Suchen
          </Button>
          <Select value={filter} onValueChange={(value) => setFilter(value as typeof filter)}>
            <SelectTrigger className="w-48" aria-label="Filter">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Alle Konten</SelectItem>
              <SelectItem value="admin">Administratoren</SelectItem>
              <SelectItem value="blocked">Gesperrt</SelectItem>
              <SelectItem value="deletion">Löschung vorgemerkt</SelectItem>
            </SelectContent>
          </Select>
        </form>
        <div className="mt-4 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>E-Mail</TableHead>
                <TableHead>Scopes</TableHead>
                <TableHead>Dabei seit</TableHead>
                <TableHead>Administrator</TableHead>
                <TableHead>Gesperrt</TableHead>
                <TableHead>Details</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(users.data?.users ?? [])
                .filter((user) =>
                  filter === "admin"
                    ? user.isAdmin
                    : filter === "blocked"
                      ? user.blocked
                      : filter === "deletion"
                        ? Boolean(user.deletionRequestedAt)
                        : true,
                )
                .map((user) => (
                <TableRow key={user.id}>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <span>{user.email}</span>
                      {user.deletionRequestedAt ? (
                        <Badge variant="secondary">Löschung vorgemerkt</Badge>
                      ) : null}
                    </div>
                  </TableCell>
                  <TableCell>{user.scopes}</TableCell>
                  <TableCell>
                    {user.createdAt ? new Date(user.createdAt).toLocaleDateString("de-DE") : "—"}
                  </TableCell>
                  <TableCell>
                    <Switch
                      checked={user.isAdmin}
                      aria-label={`Administrator für ${user.email}`}
                      onCheckedChange={(next) => role.mutate({ userId: user.id, isAdmin: next })}
                    />
                  </TableCell>
                  <TableCell>
                    <Switch
                      checked={user.blocked}
                      aria-label={`Konto ${user.email} sperren`}
                      onCheckedChange={(next) => blocked.mutate({ userId: user.id, blocked: next })}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <div className="mt-4 flex items-center justify-between gap-3 text-sm text-muted-foreground">
          <span>
            {total === 0
              ? "Keine Konten gefunden"
              : `${offset + 1}–${Math.min(offset + PAGE_SIZE, total)} von ${total}`}
          </span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={offset === 0}
              onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
            >
              Zurück
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={offset + PAGE_SIZE >= total}
              onClick={() => setOffset(offset + PAGE_SIZE)}
            >
              Weiter
            </Button>
          </div>
        </div>
      </section>

      <section className="rounded-2xl border bg-card p-6 shadow-[var(--shadow-card)]">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-display text-xl font-semibold text-brand-navy">Protokoll</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Letzte 200 Vorgänge. Aufbewahrung 90 Tage, ohne IP-Adresse und ohne Standort.
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => purge.mutate()}>
            <Trash2 className="mr-1.5 h-4 w-4" aria-hidden="true" />
            Alte Einträge entfernen
          </Button>
        </div>
        <ul className="mt-4 divide-y rounded-xl border">
          {(log.data ?? []).map((entry) => (
            <li key={entry.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-sm">
              <span className="flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                {entry.action}
              </span>
              <span className="text-xs text-muted-foreground">
                {entry.actor} · {new Date(entry.createdAt).toLocaleString("de-DE")}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
