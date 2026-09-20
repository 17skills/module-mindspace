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
    <div className="relative h-28 w-full overflow-hidden rounded-lg border bg-canvas">
      {fields.map((field, index) => (
        <div
          key={index}
          className="absolute rounded-[3px] border bg-card"
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
  onDelete,
}: {
  template: Template;
  onInsert: () => void;
  onDelete?: () => void;
}) {
  return (
    <div className="flex flex-col gap-2 rounded-xl border bg-card p-3">
      <Preview fields={template.fields} />
      <div className="min-h-10">
        <p className="font-display text-sm font-semibold">{template.title}</p>
        <p className="text-xs text-muted-foreground">{template.description}</p>
      </div>
      <div className="flex gap-2">
        <Button size="sm" className="flex-1" onClick={onInsert}>
          Einfügen
        </Button>
        {onDelete ? (
          <Button size="sm" variant="ghost" onClick={onDelete}>
            Löschen
          </Button>
        ) : null}
      </div>
    </div>
  );
}

export function TemplateDialog({ open, onOpenChange, onInsert, currentFields, userId }: Props) {
  const [own, setOwn] = useState<Template[]>([]);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);

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

  const remove = async (id: string) => {
    const { error } = await supabase.from("templates").delete().eq("id", id);
    if (error) {
      toast.error(error.message);
      return;
    }
    setOwn((current) => current.filter((item) => item.id !== id));
  };

  const insert = (template: Template) => {
    onOpenChange(false);
    void onInsert(template);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Vorlagen</DialogTitle>
          <DialogDescription>
            Fertige Feldraster einfügen oder eigene Raster speichern und wiederverwenden.
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
            <div className="flex items-center gap-2 rounded-xl border bg-muted/40 p-3">
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Name der neuen Vorlage"
                className="h-9"
              />
              <Button size="sm" onClick={() => void save()} disabled={saving}>
                Felder der Fläche speichern
              </Button>
            </div>
            {own.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Noch keine eigenen Vorlagen. Lege Felder auf der Fläche an und speichere sie hier.
              </p>
            ) : (
              <div className="grid gap-3 sm:grid-cols-3">
                {own.map((template) => (
                  <Card
                    key={template.id}
                    template={template}
                    onInsert={() => insert(template)}
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
