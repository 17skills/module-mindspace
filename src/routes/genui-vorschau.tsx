import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Renderer } from "@openuidev/react-lang";
import { Button } from "@/components/ui/button";
import { GENUI_SAMPLE, genuiLibrary } from "@/components/genui/library";
import { useTheme } from "@/lib/theme";

export const Route = createFileRoute("/genui-vorschau")({
  head: () => ({
    meta: [
      { title: "Generative Ergebnisse – Vorschau | scopebuilder" },
      { name: "description", content: "Testfläche für live erzeugte Kennzahlen, Tabellen und Auswahlknöpfe in Scope-Apps." },
      { property: "og:title", content: "Generative Ergebnisse – Vorschau" },
      { property: "og:description", content: "Live erzeugte Ergebnis-Bausteine für scopebuilder-Apps testen." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: GenuiPreview,
});

function GenuiPreview() {
  const { mode, setMode } = useTheme();
  const [shown, setShown] = useState(GENUI_SAMPLE.length);
  const [signal, setSignal] = useState<string | null>(null);
  const streaming = shown < GENUI_SAMPLE.length;

  useEffect(() => {
    if (!streaming) return;
    const t = setTimeout(() => setShown((n) => Math.min(n + 12, GENUI_SAMPLE.length)), 30);
    return () => clearTimeout(t);
  }, [shown, streaming]);

  return (
    <main className="mx-auto max-w-3xl space-y-6 p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">Generative Ergebnisse – Vorschau</h1>
        <div className="flex gap-2">
          {(["light", "dark", "system"] as const).map((m) => (
            <Button key={m} size="sm" variant={mode === m ? "default" : "outline"} onClick={() => setMode(m)}>
              {m === "light" ? "Hell" : m === "dark" ? "Dunkel" : "System"}
            </Button>
          ))}
          <Button size="sm" variant="secondary" onClick={() => { setSignal(null); setShown(0); }}>
            Streaming abspielen
          </Button>
        </div>
      </header>
      <section className="rounded-xl border border-border bg-card p-4 text-card-foreground">
        <Renderer
          response={GENUI_SAMPLE.slice(0, shown)}
          library={genuiLibrary}
          isStreaming={streaming}
          onAction={(e) => setSignal(String(e.params?.choice ?? e.humanFriendlyMessage))}
        />
      </section>
      <p className="text-sm text-muted-foreground">
        {signal ? `Signal an den Scope: „${signal}"` : "Noch keine Auswahl getroffen."}
      </p>
    </main>
  );
}
