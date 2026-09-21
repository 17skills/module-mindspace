import { Plus, RefreshCw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useBoard, type NodeRecord } from "@/components/canvas/board-context";
import { readApi, type Pair } from "@/lib/api-module";

/** Set up the request of an API module: address, method, parameters, headers. */
export function FetchTab({ record }: { record: NodeRecord }) {
  const { updateNode, runApi } = useBoard();
  const config = readApi(record);
  const meta = (record.metadata ?? {}) as Record<string, unknown>;
  const running = meta["apiRunning"] === true;

  function patch(next: Record<string, unknown>) {
    updateNode(record.id, { metadata: { ...(record.metadata ?? {}), ...next } });
  }

  function pairList(title: string, key: "params" | "headers", list: Pair[]) {
    return (
      <div>
        <p className="mb-1.5 text-xs font-medium text-muted-foreground">{title}</p>
        <div className="space-y-1">
          {list.map((pair, index) => (
            <div key={index} className="flex items-center gap-1">
              <Input
                defaultValue={pair.key}
                placeholder="Name"
                aria-label={`${title} Name ${index + 1}`}
                className="h-8 text-xs"
                onBlur={(event) => {
                  const next = [...list];
                  next[index] = { ...pair, key: event.target.value };
                  patch({ [key]: next });
                }}
              />
              <Input
                defaultValue={pair.value}
                placeholder="Wert oder {{SCHLÜSSEL}}"
                aria-label={`${title} Wert ${index + 1}`}
                className="h-8 text-xs"
                onBlur={(event) => {
                  const next = [...list];
                  next[index] = { ...pair, value: event.target.value };
                  patch({ [key]: next });
                }}
              />
              <button
                aria-label={`${title} ${index + 1} entfernen`}
                className="shrink-0 rounded-md p-1.5 text-muted-foreground hover:bg-secondary"
                onClick={() => patch({ [key]: list.filter((_, other) => other !== index) })}
              >
                <Trash2 className="size-3.5" />
              </button>
            </div>
          ))}
        </div>
        <button
          className="mt-1 flex items-center gap-1 rounded-md px-1 py-1 text-[11px] text-muted-foreground hover:bg-secondary"
          onClick={() => patch({ [key]: [...list, { key: "", value: "" }] })}
        >
          <Plus className="size-3" /> Zeile
        </button>
      </div>
    );
  }

  return (
    <div className="h-full space-y-4 overflow-auto p-3 text-sm">
      <div>
        <p className="mb-1.5 text-xs font-medium text-muted-foreground">Adresse</p>
        <Input
          key={record.id + config.url}
          defaultValue={config.url}
          placeholder="https://serpapi.com/search.json"
          className="h-8 text-xs"
          onBlur={(event) => patch({ url: event.target.value.trim() })}
        />
      </div>

      <div>
        <p className="mb-1.5 text-xs font-medium text-muted-foreground">Methode</p>
        <div className="flex gap-1.5">
          {(["GET", "POST"] as const).map((option) => (
            <button
              key={option}
              onClick={() => patch({ method: option })}
              className={`rounded-full border px-2.5 py-1 text-xs ${
                config.method === option
                  ? "border-primary bg-accent/50"
                  : "text-muted-foreground hover:bg-secondary"
              }`}
            >
              {option}
            </button>
          ))}
        </div>
      </div>

      {pairList("Parameter", "params", config.params)}
      {pairList("Kopfzeilen", "headers", config.headers)}

      {config.method === "POST" && (
        <div>
          <p className="mb-1.5 text-xs font-medium text-muted-foreground">Inhalt der Anfrage</p>
          <Textarea
            key={record.id + config.body}
            defaultValue={config.body}
            placeholder='{"frage": "…"}'
            className="min-h-20 font-mono text-xs"
            onBlur={(event) => patch({ body: event.target.value })}
          />
        </div>
      )}

      <div>
        <p className="mb-1.5 text-xs font-medium text-muted-foreground">
          Feld für die Verbindung
        </p>
        <Input
          key={record.id + config.pick}
          defaultValue={config.pick}
          placeholder="trending_searches.0.search_volume"
          className="h-8 font-mono text-xs"
          onBlur={(event) => patch({ pick: event.target.value.trim() })}
        />
      </div>

      <div className="flex items-center gap-2">
        <Button
          size="sm"
          className="rounded-full"
          disabled={running || !config.url.trim()}
          onClick={() => runApi(record.id)}
        >
          <RefreshCw className={`mr-1.5 size-3.5 ${running ? "animate-spin" : ""}`} />
          {running ? "Ruft ab …" : "Abrufen"}
        </Button>
        {config.lastAt && (
          <span className="text-xs text-muted-foreground">
            {config.lastStatus} · {new Date(config.lastAt).toLocaleString("de-DE")}
          </span>
        )}
      </div>

      <p className="rounded-lg border border-border/70 bg-secondary/40 p-2.5 text-[11px] leading-snug text-muted-foreground">
        Zugangsschlüssel nie direkt eintragen: hinterlege sie einmal sicher und schreibe hier nur
        den Platzhalter, z. B. <span className="font-mono">{"{{SERPAPI_API_KEY}}"}</span>. Der
        Schlüssel bleibt auf dem Server und wird nie gespeichert oder geteilt.
      </p>
    </div>
  );
}
