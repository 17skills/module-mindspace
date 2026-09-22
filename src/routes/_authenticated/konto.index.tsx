import { useEffect, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { getAccount, saveProfile } from "@/lib/account.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

export const Route = createFileRoute("/_authenticated/konto/")({
  component: ProfilePage,
});

/** Bild im Browser auf 160 px verkleinern, damit nur ein kleines Vorschaubild gespeichert wird. */
async function shrink(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const size = 160;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Bild konnte nicht verarbeitet werden");
  const side = Math.min(bitmap.width, bitmap.height);
  ctx.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, size, size);
  return canvas.toDataURL("image/jpeg", 0.82);
}

function ProfilePage() {
  const client = useQueryClient();
  const account = useQuery({ queryKey: ["account"], queryFn: () => getAccount() });
  const [name, setName] = useState("");
  const [avatar, setAvatar] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!account.data) return;
    setName(account.data.displayName);
    setAvatar(account.data.avatarUrl);
  }, [account.data]);

  const save = useMutation({
    mutationFn: () => saveProfile({ data: { displayName: name, avatarUrl: avatar } }),
    onSuccess: () => {
      toast.success("Profil gespeichert");
      void client.invalidateQueries({ queryKey: ["account"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const changePassword = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.auth.updateUser({
        password,
        // Lovable Cloud verlangt bei angemeldeten Konten das aktuelle Passwort
        ...(currentPassword ? { current_password: currentPassword } : {}),
      } as never);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success("Passwort geändert");
      setPassword("");
      setCurrentPassword("");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const initials = (account.data?.displayName || account.data?.email || "?").slice(0, 2).toUpperCase();

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <section className="rounded-2xl border bg-card p-6 shadow-[var(--shadow-card)]">
        <h2 className="font-display text-xl font-semibold text-brand-navy">Dein Profil</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Name und Bild sehen die Mitglieder deiner Scopes.
        </p>

        <div className="mt-6 flex items-center gap-4">
          <Avatar className="h-16 w-16">
            {avatar ? <AvatarImage src={avatar} alt="" /> : null}
            <AvatarFallback>{initials}</AvatarFallback>
          </Avatar>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
              Bild wählen
            </Button>
            {avatar ? (
              <Button variant="ghost" size="sm" onClick={() => setAvatar(null)}>
                Entfernen
              </Button>
            ) : null}
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="sr-only"
              aria-label="Profilbild hochladen"
              onChange={async (event) => {
                const file = event.target.files?.[0];
                if (!file) return;
                try {
                  setAvatar(await shrink(file));
                } catch (error) {
                  toast.error((error as Error).message);
                }
              }}
            />
          </div>
        </div>

        <div className="mt-6 space-y-4">
          <div>
            <Label htmlFor="displayName">Anzeigename</Label>
            <Input id="displayName" value={name} onChange={(event) => setName(event.target.value)} />
          </div>
          <div>
            <Label htmlFor="email">E-Mail</Label>
            <Input id="email" value={account.data?.email ?? ""} readOnly disabled />
          </div>
          <p className="text-xs text-muted-foreground">
            Mitglied seit{" "}
            {account.data?.createdAt
              ? new Date(account.data.createdAt).toLocaleDateString("de-DE")
              : "–"}{" "}
            · {account.data?.counts.boards ?? 0} eigene Scopes ·{" "}
            {account.data?.counts.apps ?? 0} Apps
          </p>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            Speichern
          </Button>
        </div>
      </section>

      <section className="rounded-2xl border bg-card p-6 shadow-[var(--shadow-card)]">
        <h2 className="font-display text-xl font-semibold text-brand-navy">Sicherheit</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Passwort ändern oder alle Anmeldungen beenden.
        </p>

        <div className="mt-6 space-y-4">
          <div>
            <Label htmlFor="current">Aktuelles Passwort</Label>
            <Input
              id="current"
              type="password"
              autoComplete="current-password"
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="next">Neues Passwort</Label>
            <Input
              id="next"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              onClick={() => changePassword.mutate()}
              disabled={password.length < 8 || changePassword.isPending}
            >
              Passwort ändern
            </Button>
            <Button
              variant="outline"
              onClick={async () => {
                await supabase.auth.signOut({ scope: "global" });
                toast.success("Alle Anmeldungen beendet");
              }}
            >
              Überall abmelden
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Mindestens 8 Zeichen. Konto löschen findest du im Bereich Datenschutz.
          </p>
        </div>
      </section>
    </div>
  );
}
