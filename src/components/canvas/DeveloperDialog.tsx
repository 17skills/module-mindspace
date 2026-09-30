import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Copy, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ApiKeysSection } from "@/components/canvas/ApiKeysSection";
import { exportBoard } from "@/lib/backup.functions";
import { useTranslation } from "@/lib/i18n";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  boardId: string;
  isOwner: boolean;
  authorEmail: string;
};

function CodeBlock({ text, filename, copyLabel, downloadLabel, copied }: { text: string; filename?: string; copyLabel: string; downloadLabel: string; copied: string }) {
  return (
    <div className="relative">
      <div className="absolute right-2 top-2 flex gap-1">
        <Button
          size="icon"
          variant="ghost"
          aria-label={copyLabel}
          onClick={() => {
            void navigator.clipboard.writeText(text);
            toast.success(copied);
          }}
        >
          <Copy className="size-4" />
        </Button>
        {filename ? (
          <Button
            size="icon"
            variant="ghost"
            aria-label={downloadLabel}
            onClick={() => {
              const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
              const link = document.createElement("a");
              link.href = url;
              link.download = filename;
              link.click();
              URL.revokeObjectURL(url);
            }}
          >
            <Download className="size-4" />
          </Button>
        ) : null}
      </div>
      <pre className="max-h-[45vh] overflow-auto rounded-lg bg-muted p-3 pr-20 text-xs leading-relaxed">
        <code>{text}</code>
      </pre>
    </div>
  );
}

/** Werkzeuge für Entwickler: Aufrufbeispiele, Schnittstellenvertrag, Bauplan und Schlüssel. */
export function DeveloperDialog({ open, onOpenChange, boardId, isOwner, authorEmail }: Props) {
  const { l } = useTranslation();
  const [manifest, setManifest] = useState(l("Wird geladen …"));
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const endpoint = `${origin}/api/public/scopes/${boardId}/run`;

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void (async () => {
      try {
        const backup = await exportBoard({ data: { boardId } });
        const { backupToManifest, manifestToYaml } = await import("@/lib/runtime/manifest");
        const text = manifestToYaml(
          backupToManifest(JSON.parse(backup.json), {
            author: authorEmail,
            origin: `scope:${boardId}`,
          }),
        );
        if (!cancelled) setManifest(text);
      } catch (error) {
        if (!cancelled) {
          setManifest(error instanceof Error ? error.message : l("Bauplan nicht verfügbar"));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, boardId, authorEmail, l]);

  const codeProps = { copyLabel: l("Code kopieren"), downloadLabel: l("Datei herunterladen"), copied: l("Kopiert") };

  const curl = `curl -X POST "${endpoint}" \\
  -H "Authorization: Bearer sbk_DEIN_SCHLUESSEL" \\
  -H "Content-Type: application/json" \\
  -d '{"input": {"text": "Beispieltext"}}'`;

  const ts = `const response = await fetch("${endpoint}", {
  method: "POST",
  headers: {
    Authorization: \`Bearer \${process.env.SCOPE_API_KEY}\`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ input: { text: "Beispieltext" } }),
});

if (!response.ok) throw new Error(await response.text());
const result = await response.json();
console.log(result.status, result.result);`;

  const py = `import os, requests

response = requests.post(
    "${endpoint}",
    headers={"Authorization": f"Bearer {os.environ['SCOPE_API_KEY']}"},
    json={"input": {"text": "Beispieltext"}},
    timeout=300,
)
response.raise_for_status()
print(response.json())`;

  const openapi = `openapi: 3.1.0
info:
  title: scopebuilder Scope ${boardId}
  version: "1.0.0"
servers:
  - url: ${origin}
paths:
  /api/public/scopes/${boardId}/run:
    post:
      summary: Scope ausführen
      security:
        - scopeKey: []
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              properties:
                input:
                  type: object
                  description: Eingaben der Quellmodule
      responses:
        "200":
          description: Ergebnis des Durchlaufs
          content:
            application/json:
              schema:
                type: object
                properties:
                  runId: { type: string, format: uuid }
                  status: { type: string, enum: [ok, error] }
                  result: { type: object }
        "401": { description: Schlüssel fehlt oder ist ungültig }
        "429": { description: Zu viele Aufrufe }
components:
  securitySchemes:
    scopeKey:
      type: http
      scheme: bearer`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{l("Code & Schnittstelle")}</DialogTitle>
          <DialogDescription>
            {l("Diesen Scope aus anderen Programmen starten. Nur für Administratoren und Entwickler sichtbar.")}
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="quickstart">
          <TabsList className="flex w-full flex-wrap">
            <TabsTrigger value="quickstart">{l("Schnellstart")}</TabsTrigger>
            <TabsTrigger value="ts">TypeScript</TabsTrigger>
            <TabsTrigger value="py">Python</TabsTrigger>
            <TabsTrigger value="openapi">OpenAPI</TabsTrigger>
            <TabsTrigger value="manifest">{l("Bauplan")}</TabsTrigger>
          </TabsList>

          <TabsContent value="quickstart" className="mt-4 space-y-3">
            <CodeBlock text={curl} {...codeProps} />
            <ApiKeysSection boardId={boardId} isOwner={isOwner} />
          </TabsContent>
          <TabsContent value="ts" className="mt-4">
            <CodeBlock text={ts} filename="scope-run.ts" {...codeProps} />
          </TabsContent>
          <TabsContent value="py" className="mt-4">
            <CodeBlock text={py} filename="scope_run.py" {...codeProps} />
          </TabsContent>
          <TabsContent value="openapi" className="mt-4">
            <CodeBlock text={openapi} filename="scope-openapi.yaml" {...codeProps} />
          </TabsContent>
          <TabsContent value="manifest" className="mt-4">
            <CodeBlock text={manifest} filename="scope.yaml" {...codeProps} />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
