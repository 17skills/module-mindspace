import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import { SYSTEM_TEMPLATES, templateBounds, type Template, type TemplateField } from "@/lib/templates";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onInsert: (template: Template) => void | Promise<void>;
  /** Fields of the currently selected template group (or all fields on the board). */
  currentFields: () => TemplateField[];
  userId: string | undefined;
};

function Preview({ fields }: { fields: TemplateField[] }) {
  const { width, height } = templateBounds(fields);
  return (
    <div className="relative h-28 w-full overflow-hidden rounded-xl border border-border/70 bg-canvas">
      {fields.map((field, index) => (
        <div
          key={index}
          className="absolute rounded-[4px] border border-border/70 bg-card"
          style={{
            left: `${(field.x / width) * 100}%`,
            top: `${(field.y / height) * 100}%`,
            width: `${(field.w / width) * 100}%`,
            height: `${(field.h / height) * 100}%`,
          }}
        />
      ))}
    </div>
  );
}

function Card({
  template,
  onInsert,
  onEdit,
  onDelete,
}: {
  template: Template;
  onInsert: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-border/70 bg-card p-3 shadow-[var(--shadow-card)] transition-shadow hover:shadow-[var(--shadow-float)]">
      <Preview fields={template.fields} />
      <div className="min-h-10">
        <p className="font-display text-sm font-semibold tracking-tight">{template.title}</p>
        <p className="text-xs text-muted-foreground">{template.description}</p>
      </div>
      <div className="flex gap-2">
        <Button size="sm" className="flex-1 rounded-full" onClick={onInsert}>
          Einfügen
        </Button>
        {onEdit ? (
          <Button size="sm" variant="outline" className="rounded-full" onClick={onEdit}>
            Bearbeiten
          </Button>
        ) : null}
        {onDelete ? (
          <Button size="sm" variant="ghost" className="rounded-full" onClick={onDelete}>
            Löschen
          </Button>
        ) : null}
      </div>
    </div>
  );
}

/** Editing form for one saved template: name, description, field names and sizes. */
function EditForm({
  template,
  currentFields,
  onSave,
  onCancel,
}: {
  template: Template;
  currentFields: () => TemplateField[];
  onSave: (next: Template) => Promise<void>;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState(template.title);
  const [description, setDescription] = useState(template.description);
  const [fields, setFields] = useState<TemplateField[]>(template.fields);
  const [busy, setBusy] = useState(false);

  const patch = (index: number, change: Partial<TemplateField>) =>
    setFields((current) =>
      current.map((field, i) => (i === index ? { ...field, ...change } : field)),
    );

  return (
    <div className="space-y-4 rounded-2xl border border-border/70 bg-muted/30 p-4">
      <div className="grid gap-2 sm:grid-cols-2">
        <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Name" className="h-9 rounded-xl" />
        <Input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Kurze Beschreibung"
          className="h-9 rounded-xl"
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-[1fr_260px]">
        <div className="space-y-2">
          {fields.map((field, index) => (
            <div key={index} className="flex items-center gap-2">
              <Input
                value={field.title}
                onChange={(e) => patch(index, { title: e.target.value })}
                placeholder="Feldname"
                className="h-9 rounded-xl"
              />
              <Input
                type="number"
                value={field.w}
                onChange={(e) => patch(index, { w: Math.max(80, Number(e.target.value) || 80) })}
                className="h-9 w-20 rounded-xl"
                aria-label="Breite"
              />
              <Input
                type="number"
                value={field.h}
                onChange={(e) => patch(index, { h: Math.max(60, Number(e.target.value) || 60) })}
                className="h-9 w-20 rounded-xl"
                aria-label="Höhe"
              />
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setFields((current) => current.filter((_, i) => i !== index))}
              >
                Entfernen
              </Button>
            </div>
          ))}
          {fields.length === 0 ? (
            <p className="text-sm text-muted-foreground">Keine Felder mehr in dieser Vorlage.</p>
          ) : null}
        </div>
        <div className="space-y-2">
          <Preview fields={fields.length ? fields : template.fields} />
          <Button
            size="sm"
            variant="outline"
            className="w-full rounded-full"
            onClick={() => {
              const next = currentFields();
              if (!next.length) {
                toast.error("Keine Felder auf der Fläche gefunden");
                return;
              }
              setFields(next);
              toast.success("Felder von der Fläche übernommen");
            }}
          >
            Felder der Auswahl übernehmen
          </Button>
        </div>
      </div>

      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" className="rounded-full" onClick={onCancel}>
          Abbrechen
        </Button>
        <Button
          size="sm"
          className="rounded-full"
          disabled={busy || !fields.length}
          onClick={() => {
            setBusy(true);
            void onSave({
              ...template,
              title: title.trim() || "Eigene Vorlage",
              description: description.trim() || `${fields.length} Felder`,
              fields,
            }).finally(() => setBusy(false));
          }}
        >
          Speichern
        </Button>
      </div>
    </div>
  );
}

export function TemplateDialog({ open, onOpenChange, onInsert, currentFields, userId }: Props) {
  const [own, setOwn] = useState<Template[]>([]);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!userId) return;
    const { data, error } = await supabase
      .from("templates")
      .select("id,title,description,fields")
      .order("created_at", { ascending: false });
    if (error) {
      toast.error(error.message);
      return;
    }
    setOwn(
      (data ?? []).map((row) => ({
        id: row.id as string,
        title: (row.title as string) ?? "Vorlage",
        description: (row.description as string | null) ?? "Eigene Vorlage",
        fields: (row.fields as unknown as TemplateField[]) ?? [],
      })),
    );
  }, [userId]);

  useEffect(() => {
    if (open) void load();
    if (!open) setEditingId(null);
  }, [open, load]);

  const save = async () => {
    if (!userId) return;
    const fields = currentFields();
    if (!fields.length) {
      toast.error("Keine Felder auf der Fläche gefunden");
      return;
    }
    setSaving(true);
    const { error } = await supabase.from("templates").insert({
      user_id: userId,
      title: name.trim() || "Eigene Vorlage",
      description: `${fields.length} Felder`,
      fields: fields as never,
    } as never);
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    setName("");
    toast.success("Vorlage gespeichert");
    void load();
  };

  const update = async (next: Template) => {
    const { error } = await supabase
      .from("templates")
      .update({
        title: next.title,
        description: next.description,
        fields: next.fields as never,
      } as never)
      .eq("id", next.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    setOwn((current) => current.map((item) => (item.id === next.id ? next : item)));
    setEditingId(null);
    toast.success("Vorlage aktualisiert");
  };

  const remove = async (id: string) => {
    const { error } = await supabase.from("templates").delete().eq("id", id);
    if (error) {
      toast.error(error.message);
      return;
    }
    setOwn((current) => current.filter((item) => item.id !== id));
    if (editingId === id) setEditingId(null);
  };

  const insert = (template: Template) => {
    onOpenChange(false);
    void onInsert(template);
  };

  const editing = own.find((item) => item.id === editingId);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto rounded-2xl sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl">Vorlagen</DialogTitle>
          <DialogDescription>
            Fertige Feldraster einfügen oder eigene Raster speichern, bearbeiten und wiederverwenden.
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="system">
          <TabsList>
            <TabsTrigger value="system">Vorschläge</TabsTrigger>
            <TabsTrigger value="own">Eigene ({own.length})</TabsTrigger>
          </TabsList>

          <TabsContent value="system" className="mt-4">
            <div className="grid gap-3 sm:grid-cols-3">
              {SYSTEM_TEMPLATES.map((template) => (
                <Card key={template.id} template={template} onInsert={() => insert(template)} />
              ))}
            </div>
          </TabsContent>

          <TabsContent value="own" className="mt-4 space-y-4">
            <div className="flex items-center gap-2 rounded-2xl border border-border/70 bg-muted/40 p-3">
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Name der neuen Vorlage"
                className="h-9 rounded-xl"
              />
              <Button size="sm" className="rounded-full" onClick={() => void save()} disabled={saving}>
                Auswahl als Vorlage speichern
              </Button>
            </div>

            {editing ? (
              <EditForm
                key={editing.id}
                template={editing}
                currentFields={currentFields}
                onSave={update}
                onCancel={() => setEditingId(null)}
              />
            ) : null}

            {own.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Noch keine eigenen Vorlagen. Lege Felder auf der Fläche an, wähle die Gruppe aus und
                speichere sie hier.
              </p>
            ) : (
              <div className="grid gap-3 sm:grid-cols-3">
                {own.map((template) => (
                  <Card
                    key={template.id}
                    template={template}
                    onInsert={() => insert(template)}
                    onEdit={() => setEditingId(template.id)}
                    onDelete={() => void remove(template.id)}
                  />
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
