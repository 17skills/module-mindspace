import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import QRCode from "qrcode";
import { Copy, ExternalLink, Trash2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { APP_KINDS, MAX_APP_MODULES, brandingFrom, suggestKind, type AppKind } from "@/lib/apps";
import {
  APP_DESIGN_PRESETS,
  DEFAULT_APP_BRANDING,
  type AppAccent,
  type AppBackground,
  type AppBranding,
} from "@/lib/zones";

type Candidate = { id: string; title: string; type: string };

type Row = {
  id: string;
  title: string;
  kind: string;
  node_ids: unknown;
  branding: unknown;
  updated_at: string;
};

const ACCENTS: { id: AppAccent; label: string; color: string }[] = [
  { id: "forest", label: "Tiefgrün", color: "#132B25" },
  { id: "sage", label: "Salbei", color: "#598381" },
  { id: "terracotta", label: "Terrakotta", color: "#DE5A3A" },
  { id: "cobalt", label: "Kobalt", color: "#2E66F6" },
];

const BACKGROUNDS: { id: AppBackground; label: string }[] = [
  { id: "stone", label: "Stein" },
  { id: "paper", label: "Papier" },
  { id: "grid", label: "Raster" },
];

export function AppDialog({
  open,
  onOpenChange,
  boardId,
  userId,
  candidates,
  preselected,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  boardId: string;
  userId: string;
  candidates: Candidate[];
  preselected: string[];
}) {
  const [apps, setApps] = useState<Row[]>([]);
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<AppKind>("cockpit");
  const [picked, setPicked] = useState<string[]>([]);
  const [branding, setBranding] = useState<AppBranding>(DEFAULT_APP_BRANDING);
  const [saving, setSaving] = useState(false);
  const [qr, setQr] = useState<{ id: string; src: string } | null>(null);
  const logoInput = useRef<HTMLInputElement>(null);

  const chosenTypes = useMemo(
    () =>
      picked
        .map((id) => candidates.find((item) => item.id === id)?.type ?? "")
        .filter(Boolean),
    [picked, candidates],
  );

  const reload = async () => {
    const { data, error } = await supabase
      .from("apps")
      .select("id,title,kind,node_ids,branding,updated_at")
      .eq("board_id", boardId)
      .order("updated_at", { ascending: false });
    if (error) {
      toast.error(error.message);
      return;
    }
    setApps((data ?? []) as Row[]);
  };

  useEffect(() => {
    if (!open) return;
    void reload();
    const start = preselected.slice(0, MAX_APP_MODULES);
    setPicked(start);
    setKind(
      suggestKind(
        start.map((id) => candidates.find((item) => item.id === id)?.type ?? ""),
      ),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const toggle = (id: string) => {
    setPicked((list) => {
      if (list.includes(id)) return list.filter((item) => item !== id);
      if (list.length >= MAX_APP_MODULES) {
        toast.error(`Höchstens ${MAX_APP_MODULES} Module pro App`);
        return list;
      }
      return [...list, id];
    });
  };

  const uploadLogo = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > 1024 * 1024) {
      toast.error("Das Logo darf höchstens 1 MB groß sein");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setBranding((b) => ({ ...b, logo: String(reader.result ?? "") }));
    reader.onerror = () => toast.error("Logo konnte nicht gelesen werden");
    reader.readAsDataURL(file);
  };

  const create = async () => {
    if (!picked.length) {
      toast.error("Bitte mindestens ein Modul wählen");
      return;
    }
    setSaving(true);
    const { data, error } = await supabase
      .from("apps")
      .insert({
        user_id: userId,
        board_id: boardId,
        title: title.trim() || (kind === "capture" ? "Foto-Erfassung" : "Lagebild"),
        kind,
        node_ids: picked,
        branding: { ...branding, title: title.trim() },
      })
      .select("id")
      .single();
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("App ausgeliefert");
    setTitle("");
    await reload();
    void showQr(String(data.id));
  };

  const remove = async (id: string) => {
    const { error } = await supabase.from("apps").delete().eq("id", id);
    if (error) {
      toast.error(error.message);
      return;
    }
    if (qr?.id === id) setQr(null);
    await reload();
  };

  const urlFor = (id: string) => `${window.location.origin}/app/${id}`;

  const showQr = async (id: string) => {
    try {
      const src = await QRCode.toDataURL(urlFor(id), { margin: 1, width: 240 });
      setQr({ id, src });
    } catch {
      setQr(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] max-w-2xl overflow-auto">
        <DialogHeader>
          <DialogTitle>App-Ansicht</DialogTitle>
          <DialogDescription>
            Bis zu {MAX_APP_MODULES} Module dieses Boards werden zu einer eigenständigen App –
            als Link für Menschen und als Datenzugang für KI-Assistenten.
          </DialogDescription>
        </DialogHeader>

        <section className="space-y-2">
          <span className="module-eyebrow text-muted-foreground">Module</span>
          <div className="grid max-h-48 gap-1 overflow-auto rounded-lg border border-border/70 p-2">
            {candidates.map((item) => (
              <label key={item.id} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={picked.includes(item.id)}
                  onChange={() => toggle(item.id)}
                />
                <span className="truncate">{item.title || "Ohne Titel"}</span>
                <span className="ml-auto font-mono text-[11px] text-muted-foreground">
                  {item.type}
                </span>
              </label>
            ))}
            {candidates.length === 0 && (
              <p className="text-sm text-muted-foreground">Dieses Board hat noch keine Module.</p>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            {picked.length} / {MAX_APP_MODULES} gewählt
            {chosenTypes.includes("inspect") ? " · Inspektionsmodul enthalten" : ""}
          </p>
        </section>

        <section className="space-y-2">
          <span className="module-eyebrow text-muted-foreground">Zweck</span>
          <div className="grid gap-2 sm:grid-cols-2">
            {APP_KINDS.map((option) => (
              <button
                key={option.id}
                onClick={() => setKind(option.id)}
                className={`rounded-lg border p-3 text-left transition-colors ${
                  kind === option.id ? "border-ring bg-accent/40" : "border-border/70 hover:bg-accent/20"
                }`}
              >
                <p className="text-sm font-medium">{option.label}</p>
                <p className="text-xs text-muted-foreground">{option.hint}</p>
              </button>
            ))}
          </div>
        </section>

        <section className="space-y-2">
          <span className="module-eyebrow text-muted-foreground">Gestaltung</span>
          <Input
            value={title}
            placeholder="Titel der App, z. B. Trafostationen-Inspektion"
            onChange={(event) => setTitle(event.target.value)}
          />
          <div className="flex flex-wrap gap-2">
            {APP_DESIGN_PRESETS.map((profile) => (
              <button
                key={profile.id}
                onClick={() => setBranding((b) => ({ ...b, ...profile.branding, logo: b.logo }))}
                className="rounded-full border border-border px-3 py-1 text-xs hover:bg-accent"
              >
                {profile.name}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {ACCENTS.map((accent) => (
              <button
                key={accent.id}
                aria-label={accent.label}
                onClick={() => setBranding((b) => ({ ...b, accent: accent.id }))}
                className={`size-7 rounded-full border-2 ${
                  branding.accent === accent.id ? "border-foreground" : "border-transparent"
                }`}
                style={{ background: accent.color }}
              />
            ))}
            <div className="ml-2 flex gap-1">
              {BACKGROUNDS.map((background) => (
                <button
                  key={background.id}
                  onClick={() => setBranding((b) => ({ ...b, background: background.id }))}
                  className={`rounded-full border px-2 py-0.5 text-[11px] ${
                    branding.background === background.id
                      ? "border-transparent bg-primary text-primary-foreground"
                      : "border-border"
                  }`}
                >
                  {background.label}
                </button>
              ))}
            </div>
            <input
              ref={logoInput}
              type="file"
              accept="image/png,image/svg+xml,.png,.svg"
              className="hidden"
              onChange={(event) => void uploadLogo(event.target.files?.[0])}
            />
            <Button variant="outline" size="sm" onClick={() => logoInput.current?.click()}>
              Logo
            </Button>
            {branding.logo && (
              <img src={branding.logo} alt="" className="size-7 rounded object-contain" />
            )}
          </div>
        </section>

        <Button onClick={() => void create()} disabled={saving}>
          App ausliefern
        </Button>

        <section className="space-y-2">
          <span className="module-eyebrow text-muted-foreground">Aktive Apps</span>
          <ul className="space-y-2">
            {apps.map((app) => {
              const count = Array.isArray(app.node_ids) ? app.node_ids.length : 0;
              const look = brandingFrom(app.branding);
              return (
                <li key={app.id} className="rounded-lg border border-border/70 p-2">
                  <div className="flex items-center gap-2">
                    <span
                      className="size-2.5 rounded-full"
                      style={{
                        background:
                          ACCENTS.find((item) => item.id === look.accent)?.color ?? "#132B25",
                      }}
                    />
                    <span className="truncate text-sm font-medium">{app.title}</span>
                    <span className="text-xs text-muted-foreground">
                      {app.kind === "capture" ? "Erfassung" : "Cockpit"} · {count} Module
                    </span>
                    <div className="ml-auto flex gap-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          void navigator.clipboard.writeText(urlFor(app.id));
                          toast.success("Link kopiert");
                        }}
                      >
                        <Copy className="size-3.5" />
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => void showQr(app.id)}>
                        QR
                      </Button>
                      <Button size="sm" variant="ghost" asChild>
                        <a href={urlFor(app.id)} target="_blank" rel="noreferrer">
                          <ExternalLink className="size-3.5" />
                        </a>
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => void remove(app.id)}>
                        <Trash2 className="size-3.5" />
                      </Button>
                    </div>
                  </div>
                  {qr?.id === app.id && (
                    <div className="mt-2 flex items-center gap-3">
                      <img src={qr.src} alt="QR-Code" className="size-28 rounded bg-white p-1" />
                      <p className="text-xs text-muted-foreground">
                        Mit dem Handy scannen, um die App vor Ort zu öffnen.
                      </p>
                    </div>
                  )}
                </li>
              );
            })}
            {apps.length === 0 && (
              <li className="text-sm text-muted-foreground">Noch keine App auf diesem Board.</li>
            )}
          </ul>
        </section>
      </DialogContent>
    </Dialog>
  );
}
