import { useEffect, useState } from "react";
import { AlertTriangle, Plug, Sparkles, TerminalSquare } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { defaultSelection, type PluginPreview, type PluginSelection } from "@/lib/runtime/plugin-adapter";

type Props = {
  preview: PluginPreview | null;
  onClose: () => void;
  onImport: (selection: PluginSelection) => void | Promise<void>;
};

export function PluginImportDialog({ preview, onClose, onImport }: Props) {
  const [sel, setSel] = useState<PluginSelection>({ skills: [], mcpServers: [], commands: [] });
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (preview) setSel(defaultSelection(preview));
  }, [preview]);
  if (!preview) return null;

  const toggle = (key: keyof PluginSelection, id: string, on: boolean) =>
    setSel((s) => ({ ...s, [key]: on ? [...s[key], id] : s[key].filter((x) => x !== id) }));
  const count = sel.skills.length + sel.mcpServers.length + sel.commands.length;

  const Row = ({ k, id, label, hint, disabled }: { k: keyof PluginSelection; id: string; label: string; hint: string; disabled?: boolean }) => (
    <label className="flex items-start gap-3 rounded-md border border-border p-2 text-sm has-[:disabled]:opacity-60">
      <Checkbox
        checked={sel[k].includes(id)}
        disabled={disabled}
        onCheckedChange={(v) => toggle(k, id, v === true)}
        aria-label={label}
        className="mt-0.5"
      />
      <span className="min-w-0">
        <span className="block font-medium break-words">{label}</span>
        {hint && <span className="block text-xs text-muted-foreground break-words">{hint}</span>}
      </span>
    </label>
  );

  const Section = ({ icon, title, children, n }: { icon: React.ReactNode; title: string; n: number; children: React.ReactNode }) =>
    n ? (
      <section className="space-y-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          {icon}
          {title} <span className="text-muted-foreground">({n})</span>
        </h3>
        {children}
      </section>
    ) : null;

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Plugin „{preview.name}" {preview.version && <span className="text-muted-foreground">v{preview.version}</span>}</DialogTitle>
          <DialogDescription>{preview.description || "Wähle, was auf den Scope übernommen wird."}</DialogDescription>
        </DialogHeader>
        <ScrollArea className="max-h-[60vh] pr-3">
          <div className="space-y-4">
            <Section icon={<Sparkles className="h-4 w-4" />} title="Skills" n={preview.skills.length}>
              {preview.skills.map((s) => (
                <Row key={s.id} k="skills" id={s.id} label={s.skill.title} hint={s.skill.description} />
              ))}
            </Section>
            <Section icon={<Plug className="h-4 w-4" />} title="MCP-Server (nur vorgemerkt)" n={preview.mcpServers.length}>
              {preview.mcpServers.map((m) => (
                <Row key={m.id} k="mcpServers" id={m.id} label={m.name} hint={`${m.url ?? m.transport} – ${m.note}`} disabled={!m.connectable} />
              ))}
            </Section>
            <Section icon={<TerminalSquare className="h-4 w-4" />} title="Befehle als Vorlagen" n={preview.commands.length}>
              {preview.commands.map((c) => (
                <Row key={c.id} k="commands" id={c.id} label={c.name} hint={c.description} />
              ))}
            </Section>
            {(preview.skipped.length > 0 || preview.errors.length > 0) && (
              <section className="space-y-2 rounded-md border border-border bg-muted/50 p-3">
                <h3 className="flex items-center gap-2 text-sm font-semibold">
                  <AlertTriangle className="h-4 w-4" /> Nicht übernommen
                </h3>
                <ul className="space-y-1 text-xs text-muted-foreground">
                  {preview.skipped.map((s) => (
                    <li key={s.path} className="break-words"><span className="font-mono">{s.path}</span> – {s.reason}</li>
                  ))}
                  {preview.errors.map((e) => (
                    <li key={e} className="break-words text-destructive">{e}</li>
                  ))}
                </ul>
              </section>
            )}
            {!preview.skills.length && !preview.mcpServers.length && !preview.commands.length && (
              <p className="text-sm text-muted-foreground">Keine übernehmbaren Bestandteile gefunden.</p>
            )}
          </div>
        </ScrollArea>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={busy}>Abbrechen</Button>
          <Button
            disabled={!count || busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onImport(sel);
              } finally {
                setBusy(false);
              }
            }}
          >
            {count} übernehmen
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
