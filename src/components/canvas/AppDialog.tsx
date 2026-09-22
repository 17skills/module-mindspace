import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import QRCode from "qrcode";
import {
  Bot,
  Copy,
  ExternalLink,
  Key,
  Maximize2,
  Minimize2,
  Monitor,
  Eye,
  EyeOff,
  Pencil,
  PlugZap,
  Smartphone,
  Trash2,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import type { NodeRecord } from "@/components/canvas/board-context";
import { AppEngine } from "@/components/app/AppEngine";
import { APP_LAYOUTS, resolveLayout } from "@/lib/app-layout";
import { MAX_APP_MODULES, brandingFrom, moduleLabel } from "@/lib/apps";
import {
  APP_DESIGN_PRESETS,
  DEFAULT_APP_BRANDING,
  type AppAccent,
  type AppBackground,
  type AppBranding,
} from "@/lib/zones";

type Candidate = NodeRecord;

type Row = {
  id: string;
  title: string;
  description: string | null;
  kind: string;
  node_ids: unknown;
  branding: unknown;
  mcp_token: string;
  mcp_scope: string;
  is_public: boolean;
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

const PROMPTS = [
  "Zeig mir alle offenen Befunde mit Dringlichkeit 1–3 und schlage eine Reihenfolge für diese Woche vor.",
  "Welche Kennzahlen hat diese App gerade? Fasse die Lage in fünf Sätzen zusammen.",
  "Trage einen neuen Befund ein: Trafostation Nord 7, Zaun beschädigt, Dringlichkeit 4, geschätzt 2400 €.",
  "Setze den Befund mit der höchsten Dringlichkeit auf „beauftragt“ und trage Team West als zuständig ein.",
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
  const [editing, setEditing] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");
  const [scope, setScope] = useState<"read" | "write">("read");
  const [picked, setPicked] = useState<string[]>([]);
  const [branding, setBranding] = useState<AppBranding>(DEFAULT_APP_BRANDING);
  const [saving, setSaving] = useState(false);
  const [wide, setWide] = useState(false);
  const [qr, setQr] = useState<{ id: string; src: string } | null>(null);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [docsFor, setDocsFor] = useState<string | null>(null);
  const [tab, setTab] = useState("module");
  const logoInput = useRef<HTMLInputElement>(null);

  const pickedNodes = useMemo(
    () =>
      picked
        .map((id) => candidates.find((item) => item.id === id))
        .filter((item): item is Candidate => Boolean(item)),
    [picked, candidates],
  );
  const chosenTypes = useMemo(() => pickedNodes.map((node) => node.type), [pickedNodes]);
  const kind: "capture" | "cockpit" =
    resolveLayout(branding.layout, chosenTypes) === "capture" ? "capture" : "cockpit";


  const reload = async () => {
    const { data, error } = await supabase
      .from("apps")
      .select("id,title,description,kind,node_ids,branding,mcp_token,mcp_scope,is_public,updated_at")
      .eq("board_id", boardId)
      .order("updated_at", { ascending: false });
    if (error) {
      toast.error(error.message);
      return;
    }
    setApps((data ?? []) as Row[]);
  };

  const resetForm = (start: string[]) => {
    setEditing(null);
    setTitle("");
    setDescription("");
    setBranding(DEFAULT_APP_BRANDING);
    setScope("read");
    setPicked(start);
  };


  useEffect(() => {
    if (!open) return;
    void reload();
    resetForm(preselected.slice(0, MAX_APP_MODULES));
    setTab("module");
    setTestResult(null);
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

  /** Reihenfolge der Module in der App verschieben. */
  const move = (index: number, delta: number) => {
    setPicked((list) => {
      const next = [...list];
      const target = index + delta;
      if (target < 0 || target >= next.length) return list;
      const [item] = next.splice(index, 1);
      next.splice(target, 0, item!);
      return next;
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

  const submit = async () => {
    if (!picked.length) {
      toast.error("Bitte mindestens ein Modul wählen");
      return;
    }
    setSaving(true);
    const name = title.trim() || (kind === "capture" ? "Foto-Erfassung" : "Lagebild");
    const payload = {
      title: name,
      description: description.trim(),
      kind,
      node_ids: picked,
      mcp_scope: scope,
      branding: { ...branding, title: title.trim() },
    };
    if (editing) {
      const { error } = await supabase
        .from("apps")
        .update({ ...payload, updated_at: new Date().toISOString() })
        .eq("id", editing);
      setSaving(false);
      if (error) {
        toast.error(error.message);
        return;
      }
      toast.success("App aktualisiert – Link und KI-Anschluss bleiben gleich");
      await reload();
      return;
    }
    const { data, error } = await supabase
      .from("apps")
      .insert({ user_id: userId, board_id: boardId, ...payload })
      .select("id")
      .single();
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("App ausgeliefert");
    resetForm([]);
    await reload();
    void showQr(String(data.id));
  };

  const edit = (app: Row) => {
    setEditing(app.id);
    setTitle(app.title);
    setDescription(app.description ?? "");
    setDevice("desktop");
    setScope(app.mcp_scope === "write" ? "write" : "read");
    setPicked(Array.isArray(app.node_ids) ? (app.node_ids as unknown[]).map(String) : []);
    setBranding(brandingFrom(app.branding));
    setTab("module");
  };

  const remove = async (id: string) => {
    const { error } = await supabase.from("apps").delete().eq("id", id);
    if (error) {
      toast.error(error.message);
      return;
    }
    if (qr?.id === id) setQr(null);
    if (editing === id) resetForm([]);
    await reload();
  };

  /** App veröffentlichen oder wieder abschalten – der Link bleibt erhalten. */
  const togglePublic = async (app: Row) => {
    const next = !app.is_public;
    const { error } = await supabase
      .from("apps")
      .update({ is_public: next, updated_at: new Date().toISOString() })
      .eq("id", app.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(next ? "App ist jetzt öffentlich erreichbar" : "App ist abgeschaltet");
    await reload();
  };

  const urlFor = (id: string) => `${window.location.origin}/app/${id}`;
  const mcpFor = (app: Row) =>
    `${window.location.origin}/api/public/app/${app.id}/mcp?token=${app.mcp_token}`;
  const copy = (text: string, note: string) => {
    void navigator.clipboard.writeText(text);
    toast.success(note);
  };

  const claudeConfig = (app: Row) =>
    JSON.stringify(
      {
        mcpServers: {
          [app.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "scope-app"]: {
            command: "npx",
            args: ["-y", "mcp-remote", mcpFor(app)],
          },
        },
      },
      null,
      2,
    );

  const testConnection = async (app: Row) => {
    setTesting(true);
    setTestResult(null);
    try {
      const response = await fetch(mcpFor(app), {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            protocolVersion: "2024-11-05",
            capabilities: {},
            clientInfo: { name: "scopebuilder-test", version: "1.0" },
          },
        }),
      });
      if (response.status === 401) {
        setTestResult("Schlüssel abgelehnt – bitte Link neu kopieren.");
      } else if (!response.ok) {
        setTestResult(`Endpunkt antwortet mit Fehler ${response.status}.`);
      } else {
        setTestResult(
          app.mcp_scope === "write"
            ? "Verbindung erfolgreich – 5 Werkzeuge aktiv (Lesen und Schreiben)."
            : "Verbindung erfolgreich – 3 Werkzeuge aktiv (nur Lesen).",
        );
      }
    } catch {
      setTestResult("Der Endpunkt war nicht erreichbar.");
    } finally {
      setTesting(false);
    }
  };

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
      <DialogContent
        className={
          wide
            ? "flex h-[96vh] w-[97vw] max-w-none flex-col gap-0 overflow-hidden p-0"
            : "flex h-[88vh] w-[95vw] max-w-6xl flex-col gap-0 overflow-hidden p-0"
        }
      >
        <DialogHeader className="px-6 pt-6">
          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
            <div className="min-w-0">
              <DialogTitle>App-Ansicht</DialogTitle>
              <DialogDescription>
                Bis zu {MAX_APP_MODULES} Module dieses Scopes werden zu einer eigenständigen App –
                als Link für Menschen und als Datenzugang für KI-Assistenten.
              </DialogDescription>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="shrink-0"
              onClick={() => setWide((value) => !value)}
            >
              {wide ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
            </Button>
          </div>
        </DialogHeader>

        <div className="grid min-h-0 flex-1 lg:grid-cols-[minmax(0,440px)_minmax(0,1fr)]">
          <div className="min-h-0 overflow-auto border-border/70 px-6 py-4 lg:border-r">

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="w-full justify-start">
            <TabsTrigger value="module">1 · Module</TabsTrigger>
            <TabsTrigger value="design">2 · Gestaltung</TabsTrigger>
            <TabsTrigger value="access">3 · Zugriff</TabsTrigger>
            <TabsTrigger value="deliver">4 · Ausliefern</TabsTrigger>
            <TabsTrigger value="docs">5 · KI</TabsTrigger>
          </TabsList>


          {/* 1 – Module */}
          <TabsContent value="module" className="space-y-3">
            {editing && (
              <p className="rounded-lg border border-border/70 bg-accent/30 p-2 text-xs">
                Du bearbeitest eine aktive App. Änderungen gelten sofort – der Link bleibt gleich.{" "}
                <button className="underline" onClick={() => resetForm([])}>
                  Neue App stattdessen
                </button>
              </p>
            )}
            <div className="grid max-h-60 gap-1 overflow-auto rounded-lg border border-border/70 p-2">
              {candidates.map((item) => (
                <label key={item.id} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={picked.includes(item.id)}
                    onChange={() => toggle(item.id)}
                  />
                  <span className="truncate">{moduleLabel(item.type, item.title ?? "")}</span>
                </label>
              ))}
              {candidates.length === 0 && (
                <p className="text-sm text-muted-foreground">Dieser Scope hat noch keine Module.</p>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              {picked.length} / {MAX_APP_MODULES} gewählt
              {chosenTypes.includes("inspect") ? " · Inspektionsmodul enthalten" : ""}
            </p>
            {pickedNodes.length > 0 && (
              <ul className="space-y-1 rounded-lg border border-border/70 p-2">
                {pickedNodes.map((node, index) => (
                  <li
                    key={node.id}
                    className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 text-sm"
                  >
                    <span className="truncate">{moduleLabel(node.type, node.title ?? "")}</span>
                    <span className="flex shrink-0 gap-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={index === 0}
                        onClick={() => move(index, -1)}
                      >
                        ↑
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={index === pickedNodes.length - 1}
                        onClick={() => move(index, 1)}
                      >
                        ↓
                      </Button>
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <div>
              <span className="module-eyebrow text-muted-foreground">Aufbau</span>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                {APP_LAYOUTS.map((option) => (
                  <button
                    key={option.id}
                    onClick={() => setBranding((b) => ({ ...b, layout: option.id }))}
                    className={`rounded-lg border p-3 text-left transition-colors ${
                      branding.layout === option.id
                        ? "border-ring bg-accent/40"
                        : "border-border/70 hover:bg-accent/20"
                    }`}
                  >
                    <p className="text-sm font-medium">{option.label}</p>
                    <p className="text-xs text-muted-foreground">{option.hint}</p>
                  </button>
                ))}
              </div>
            </div>

          </TabsContent>

          {/* 2 – Gestaltung */}
          <TabsContent value="design" className="space-y-3">
            <Input
              value={title}
              placeholder="Titel der App, z. B. Trafostationen-Inspektion"
              onChange={(event) => setTitle(event.target.value)}
            />
            <Textarea
              value={description}
              rows={2}
              placeholder="Kurze Beschreibung, z. B. Vor-Ort-Erfassung für Team West"
              onChange={(event) => setDescription(event.target.value)}
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
          </TabsContent>

          {/* 3 – Zugriff */}
          <TabsContent value="access" className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Menschen öffnen die App über den Link – ohne Konto. KI-Assistenten brauchen zusätzlich
              den Schlüssel dieser App.
            </p>
            <div className="grid gap-2 sm:grid-cols-2">
              {(
                [
                  {
                    id: "read" as const,
                    label: "Nur lesen",
                    hint: "Befunde und Kennzahlen abrufen. Nichts ändern.",
                  },
                  {
                    id: "write" as const,
                    label: "Lesen und schreiben",
                    hint: "Zusätzlich Befunde melden und Status setzen.",
                  },
                ]
              ).map((option) => (
                <button
                  key={option.id}
                  onClick={() => setScope(option.id)}
                  className={`rounded-lg border p-3 text-left transition-colors ${
                    scope === option.id ? "border-ring bg-accent/40" : "border-border/70 hover:bg-accent/20"
                  }`}
                >
                  <p className="text-sm font-medium">{option.label}</p>
                  <p className="text-xs text-muted-foreground">{option.hint}</p>
                </button>
              ))}
            </div>
          </TabsContent>

          {/* 4 – Ausliefern */}
          <TabsContent value="deliver" className="space-y-3">
            <Button onClick={() => void submit()} disabled={saving} className="w-full">
              {editing ? "Änderungen speichern" : "App ausliefern"}
            </Button>
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
                      <span
                        className={`rounded-full px-2 py-0.5 text-[11px] ${
                          app.is_public
                            ? "bg-brand-sage/20 text-brand-navy"
                            : "bg-muted text-muted-foreground"
                        }`}
                      >
                        {app.is_public ? "Aktiv" : "Inaktiv"}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {app.kind === "capture" ? "Erfassung" : "Cockpit"} · {count} Module ·{" "}
                        {app.mcp_scope === "write" ? "KI darf schreiben" : "KI liest nur"}
                      </span>
                      <div className="ml-auto flex gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          title={app.is_public ? "App abschalten" : "App veröffentlichen"}
                          onClick={() => void togglePublic(app)}
                        >
                          {app.is_public ? (
                            <Eye className="size-3.5" />
                          ) : (
                            <EyeOff className="size-3.5" />
                          )}
                        </Button>
                        <Button size="sm" variant="ghost" title="Bearbeiten" onClick={() => edit(app)}>
                          <Pencil className="size-3.5" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          title="App-Link kopieren"
                          onClick={() => copy(urlFor(app.id), "App-Link kopiert")}
                        >
                          <Copy className="size-3.5" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          title="KI-Anschluss mit Schlüssel kopieren"
                          onClick={() => copy(mcpFor(app), "KI-Anschluss kopiert")}
                        >
                          <Bot className="size-3.5" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          title="Anleitung anzeigen"
                          onClick={() => {
                            setDocsFor(app.id);
                            setTestResult(null);
                            setTab("docs");
                          }}
                        >
                          <PlugZap className="size-3.5" />
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
                    {app.description ? (
                      <p className="mt-1 text-xs text-muted-foreground">{app.description}</p>
                    ) : null}
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
                <li className="text-sm text-muted-foreground">Noch keine App in diesem Scope.</li>
              )}
            </ul>
          </TabsContent>

          {/* 5 – KI-Anleitung */}
          <TabsContent value="docs" className="space-y-3">
            {(() => {
              const app = apps.find((item) => item.id === docsFor) ?? apps[0];
              if (!app) {
                return (
                  <p className="text-sm text-muted-foreground">
                    Liefere zuerst eine App aus – danach steht hier die Anleitung.
                  </p>
                );
              }
              return (
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium">{app.title}</span>
                    {apps.length > 1 && (
                      <select
                        className="rounded-md border border-border bg-background px-2 py-1 text-xs"
                        value={app.id}
                        onChange={(event) => setDocsFor(event.target.value)}
                      >
                        {apps.map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.title}
                          </option>
                        ))}
                      </select>
                    )}
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={testing}
                      onClick={() => void testConnection(app)}
                    >
                      <PlugZap className="size-3.5" />
                      Verbindung testen
                    </Button>
                    {testResult && <span className="text-xs">{testResult}</span>}
                  </div>

                  <div className="rounded-lg border border-border/70 p-3">
                    <div className="flex items-center gap-2">
                      <Key className="size-3.5 text-muted-foreground" />
                      <span className="module-eyebrow text-muted-foreground">
                        Verbindungsadresse mit Schlüssel
                      </span>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="ml-auto"
                        onClick={() => copy(mcpFor(app), "Adresse kopiert")}
                      >
                        <Copy className="size-3.5" />
                      </Button>
                    </div>
                    <p className="mt-1 break-all font-mono text-[11px] text-muted-foreground">
                      {mcpFor(app)}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Rechte: {app.mcp_scope === "write" ? "lesen und schreiben" : "nur lesen"}. Der
                      Schlüssel wirkt wie ein Passwort – nur an vertraute Assistenten geben.
                    </p>
                  </div>

                  <div className="rounded-lg border border-border/70 p-3">
                    <div className="flex items-center gap-2">
                      <span className="module-eyebrow text-muted-foreground">Claude Desktop</span>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="ml-auto"
                        onClick={() => copy(claudeConfig(app), "Einstellung kopiert")}
                      >
                        <Copy className="size-3.5" />
                      </Button>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      In Claude Desktop unter Einstellungen → Entwickler → Konfiguration bearbeiten
                      einfügen und Claude neu starten.
                    </p>
                    <pre className="mt-2 overflow-auto rounded bg-secondary p-2 font-mono text-[11px]">
{claudeConfig(app)}
                    </pre>
                  </div>

                  <div className="rounded-lg border border-border/70 p-3 text-xs text-muted-foreground">
                    <p className="module-eyebrow text-muted-foreground">
                      VS Code / Copilot, Cursor und andere
                    </p>
                    <ol className="mt-1 list-decimal space-y-1 pl-4">
                      <li>Im Assistenten „MCP-Server hinzufügen“ wählen und Typ „HTTP“ nehmen.</li>
                      <li>Obige Adresse einfügen – der Schlüssel steckt bereits darin.</li>
                      <li>
                        Alternativ Adresse ohne <code>?token=</code> eintragen und den Schlüssel als
                        Kopfzeile <code>Authorization: Bearer …</code> hinterlegen.
                      </li>
                      <li>Speichern, Assistent neu laden, dann „Verbindung testen“ hier drücken.</li>
                    </ol>
                  </div>

                  <div className="rounded-lg border border-border/70 p-3">
                    <span className="module-eyebrow text-muted-foreground">Beispiel-Anfragen</span>
                    <ul className="mt-2 space-y-1">
                      {PROMPTS.map((prompt) => (
                        <li key={prompt} className="flex items-start gap-2">
                          <button
                            className="text-left text-xs hover:underline"
                            onClick={() => copy(prompt, "Anfrage kopiert")}
                          >
                            {prompt}
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              );
            })()}
          </TabsContent>
        </Tabs>
          </div>

          <div className="hidden min-h-0 flex-col bg-muted/40 lg:flex">
            <div className="flex items-center gap-2 border-b border-border/70 px-4 py-2">
              <span className="module-eyebrow text-muted-foreground">Live-Vorschau</span>
              <div className="ml-auto flex gap-1">
                <Button
                  size="sm"
                  variant={device === "desktop" ? "secondary" : "ghost"}
                  onClick={() => setDevice("desktop")}
                >
                  <Monitor className="size-3.5" />
                </Button>
                <Button
                  size="sm"
                  variant={device === "mobile" ? "secondary" : "ghost"}
                  onClick={() => setDevice("mobile")}
                >
                  <Smartphone className="size-3.5" />
                </Button>
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-auto p-4">
              <div
                className={`mx-auto overflow-hidden rounded-xl border border-border/70 bg-background shadow-[var(--shadow-card)] ${
                  device === "mobile" ? "w-[390px]" : "w-full"
                }`}
              >
                <div
                  className={`app-shell app-accent-${branding.accent} app-background-${branding.background} flex min-h-[520px] flex-col`}
                >
                  <header className="app-header grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b px-4 py-2.5">
                    <div className="flex min-w-0 items-center gap-3">
                      {branding.logo ? (
                        <img
                          src={branding.logo}
                          alt=""
                          className="app-brand-logo shrink-0 rounded-md bg-card object-contain p-1"
                          style={{ width: branding.logoSize, height: branding.logoSize }}
                        />
                      ) : (
                        <div className="app-logo-mark size-3 shrink-0 rounded-sm" aria-hidden />
                      )}
                      <div className="min-w-0">
                        <span className="module-eyebrow block text-muted-foreground">
                          {kind === "capture" ? "Vor-Ort-Erfassung" : "Scope-App"}
                        </span>
                        <span className="block truncate font-display text-base font-semibold">
                          {title.trim() || "Titel der App"}
                        </span>
                      </div>
                    </div>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {APP_LAYOUTS.find((item) => item.id === branding.layout)?.label}
                    </span>
                  </header>
                  {kind === "capture" ? (
                    <div className="flex-1 space-y-3 p-4">
                      <div className="flex aspect-[4/3] w-full items-center justify-center rounded-lg border border-dashed border-border text-sm text-muted-foreground">
                        Kamera-Fläche
                      </div>
                      <div className="h-12 rounded-lg bg-primary/90" />
                      <p className="text-xs text-muted-foreground">
                        Foto, Standort und KI-Bewertung – so sieht die Erfassung auf dem Handy aus.
                      </p>
                    </div>
                  ) : (
                    <AppEngine nodes={pickedNodes} layout={branding.layout} />
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </DialogContent>

    </Dialog>
  );
}
