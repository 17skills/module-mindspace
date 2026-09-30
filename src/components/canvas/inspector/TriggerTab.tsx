import { useEffect, useMemo, useState } from "react";
import { useParams } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, Play, Plus, RotateCcw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { NodeRecord } from "@/components/canvas/board-context";
import {
  TRIGGER_OPERATORS,
  evaluateTrigger,
  formatLogReason,
  operatorLabel,
  listPaths,
  matchesExclude,
  validateExcludePattern,
  parseConditions,
  parseExcludePaths,
  redactPayload,
  type TriggerCondition,
  type TriggerEvaluation,
  type TriggerOperator,
} from "@/lib/trigger-conditions";
import {
  deleteTrigger,
  listTriggers,
  rotateTriggerSecret,
  saveTrigger,
  testTrigger,
} from "@/lib/triggers.functions";

type Mode = "webhook" | "cron" | "hybrid";
type PatternInfo = { pattern: string; error: string | null; hits: string[] };

/** Erfundene Beispiele zum Testen der Muster – werden nie gespeichert. */
const SAMPLES: { label: string; hint: string; data: unknown }[] = [
  { label: "Einfach", hint: "Flache Werte", data: { wind: 82, status: "ok" } },
  {
    label: "Verschachtelt",
    hint: "Tiefe Objekte, z. B. kunde.adresse oder **.token",
    data: { kunde: { name: "Muster", adresse: { plz: "10115", ort: "Berlin" }, auth: { token: "abc" } }, wind: 82 },
  },
  {
    label: "Kurze Liste",
    hint: "1 Eintrag – users[1].email trifft hier nichts",
    data: { users: [{ name: "A", email: "a@example.org" }] },
  },
  {
    label: "Lange Liste",
    hint: "4 Einträge – vergleiche users[*] mit users[0]",
    data: {
      users: [
        { name: "A", email: "a@example.org" },
        { name: "B", email: "b@example.org" },
        { name: "C", email: "c@example.org", tags: ["x"] },
        { name: "D", email: "d@example.org" },
      ],
    },
  },
  {
    label: "Listen in Listen",
    hint: "Unterschiedlich lange innere Listen, z. B. orders[*].items[*].price",
    data: { orders: [{ id: 1, items: [{ price: 5 }] }, { id: 2, items: [{ price: 7 }, { price: 9 }, { price: 1 }] }] },
  },
];

const MODE_LABEL: Record<Mode, string> = {
  webhook: "Ereignis",
  cron: "Zeitplan",
  hybrid: "Beides",
};

const INTERVALS = [
  { value: 5, label: "alle 5 Minuten" },
  { value: 15, label: "alle 15 Minuten" },
  { value: 30, label: "alle 30 Minuten" },
  { value: 60, label: "stündlich" },
  { value: 360, label: "alle 6 Stunden" },
  { value: 1440, label: "täglich" },
];

const NEEDS_VALUE: TriggerOperator[] = [
  "gt",
  "gte",
  "lt",
  "lte",
  "eq",
  "neq",
  "contains",
  "delta_abs",
  "delta_pct",
];

/** Automatische Auslöser eines Startmoduls: Ereignis, Zeitplan und Schwellenwerte. */
export function TriggerTab({ record }: { record: NodeRecord }) {
  const params = useParams({ strict: false }) as { boardId?: string };
  const boardId = params.boardId ?? "";
  const client = useQueryClient();

  const query = useQuery({
    queryKey: ["triggers", boardId],
    queryFn: () => listTriggers({ data: { boardId } }),
    enabled: Boolean(boardId),
  });

  const existing = useMemo(
    () => (query.data ?? []).find((row) => row.node_id === record.id) ?? null,
    [query.data, record.id],
  );

  const [mode, setMode] = useState<Mode>("webhook");
  const [enabled, setEnabled] = useState(true);
  const [interval, setIntervalMinutes] = useState(60);
  const [probeUrl, setProbeUrl] = useState("");
  const [matchMode, setMatchMode] = useState<"any" | "all">("any");
  const [conditions, setConditions] = useState<TriggerCondition[]>([]);
  const [logValues, setLogValues] = useState(false);
  const [logExclude, setLogExclude] = useState("");
  const [excludeDraft, setExcludeDraft] = useState("");
  const excludeList = useMemo(() => parseExcludePaths(logExclude), [logExclude]);
  const draftError = excludeDraft.trim() ? validateExcludePattern(excludeDraft) : null;
  function addExclude() {
    const next = excludeDraft.trim();
    if (!next || validateExcludePattern(next)) return;
    setLogExclude(parseExcludePaths([...excludeList, next]).join(", "));
    setExcludeDraft("");
  }
  const [secret, setSecret] = useState<string | null>(null);
  const [sample, setSample] = useState('{\n  "wind": 82\n}');
  const [check, setCheck] = useState<TriggerEvaluation | null>(null);

  useEffect(() => {
    if (!existing) return;
    setMode((existing.mode as Mode) ?? "webhook");
    setEnabled(existing.enabled);
    setIntervalMinutes(existing.interval_minutes ?? 60);
    setProbeUrl(existing.probe_url ?? "");
    setMatchMode(existing.match_mode === "all" ? "all" : "any");
    setLogValues(existing.log_values === true);
    setLogExclude((existing.log_exclude ?? []).join(", "));
    setConditions(Array.isArray(existing.conditions) ? (existing.conditions as TriggerCondition[]) : []);
  }, [existing?.id]);

  const save = useMutation({
    mutationFn: () =>
      saveTrigger({
        data: {
          id: existing?.id,
          boardId,
          nodeId: record.id,
          name: record.title ?? "Auslöser",
          mode,
          enabled,
          intervalMinutes: mode === "webhook" ? null : interval,
          probeUrl: probeUrl.trim() || null,
          matchMode,
          conditions: conditions.filter((c) => c.path.trim()),
          logValues,
          logExclude: excludeList,
        },
      }),
    onSuccess: (result) => {
      if (result.secret) setSecret(result.secret);
      toast.success("Auslöser gespeichert.");
      client.invalidateQueries({ queryKey: ["triggers", boardId] });
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Speichern fehlgeschlagen"),
  });

  const rotate = useMutation({
    mutationFn: () => rotateTriggerSecret({ data: { id: existing!.id, boardId } }),
    onSuccess: (result) => {
      setSecret(result.secret);
      toast.success("Neuer Schlüssel erzeugt. Der alte gilt nicht mehr.");
    },
  });

  const remove = useMutation({
    mutationFn: () => deleteTrigger({ data: { id: existing!.id, boardId } }),
    onSuccess: () => {
      setSecret(null);
      client.invalidateQueries({ queryKey: ["triggers", boardId] });
      toast.success("Auslöser entfernt.");
    },
  });

  const simulate = useMutation({
    mutationFn: () =>
      testTrigger({
        data: {
          boardId,
          payload: sample,
          matchMode,
          conditions: conditions.filter((c) => c.path.trim()),
          previous: {},
        },
      }),
    onSuccess: (result) => setCheck(result),
    onError: (error) => toast.error(error instanceof Error ? error.message : "Probe fehlgeschlagen"),
  });

  const preview = useMemo(() => {
    let payload: unknown;
    try {
      payload = JSON.parse(sample);
    } catch {
      return { error: "Beispieldaten sind kein gültiges JSON.", check: null, reason: "", redacted: "", hidden: 0, patterns: [] as PatternInfo[] };
    }
    const check = evaluateTrigger(parseConditions(conditions.filter((c) => c.path.trim())), payload, {}, matchMode);
    const redactedValue = redactPayload(payload, excludeList);
    const redacted = JSON.stringify(redactedValue, null, 2);
    const hidden = (redacted.match(/"\[ausgeschlossen\]"/g) ?? []).length;
    const paths = listPaths(payload);
    const patterns: PatternInfo[] = excludeList.map((pattern) => {
      const error = validateExcludePattern(pattern);
      const hits = error ? [] : paths.filter((p) => matchesExclude(p, pattern) && !paths.some((q) => q !== p && p.startsWith(q) && matchesExclude(q, pattern)));
      return { pattern, error, hits };
    });
    return { error: null, check, reason: formatLogReason(check, { showValues: logValues, exclude: excludeList }), redacted, hidden, patterns };
  }, [sample, conditions, matchMode, excludeList, logValues]);

  const webhookUrl =
    existing && typeof window !== "undefined"
      ? `${window.location.origin}/api/public/triggers/${existing.id}`
      : "";

  function patchCondition(index: number, patch: Partial<TriggerCondition>) {
    setConditions((list) => list.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  }

  return (
    <div className="h-full space-y-5 overflow-auto p-3 text-sm">
      <section className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-medium text-muted-foreground">Art des Auslösers</p>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Aktiv</span>
            <Switch checked={enabled} onCheckedChange={setEnabled} aria-label="Auslöser aktiv" />
          </div>
        </div>
        <div className="flex gap-1.5">
          {(Object.keys(MODE_LABEL) as Mode[]).map((option) => (
            <button
              key={option}
              onClick={() => setMode(option)}
              className={`rounded-full border px-2.5 py-1 text-xs ${
                mode === option ? "border-primary bg-accent/50" : "text-muted-foreground hover:bg-secondary"
              }`}
            >
              {MODE_LABEL[option]}
            </button>
          ))}
        </div>
      </section>

      {mode !== "webhook" && (
        <section className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground">Zeitplan</p>
          <div className="flex flex-wrap gap-1.5">
            {INTERVALS.map((option) => (
              <button
                key={option.value}
                onClick={() => setIntervalMinutes(option.value)}
                className={`rounded-full border px-2.5 py-1 text-xs ${
                  interval === option.value
                    ? "border-primary bg-accent/50"
                    : "text-muted-foreground hover:bg-secondary"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
          <Input
            value={probeUrl}
            onChange={(event) => setProbeUrl(event.target.value)}
            placeholder="https://api.example.com/wetter (wird vor der Prüfung gelesen)"
            className="h-8 text-xs"
          />
          <p className="text-[11px] text-muted-foreground">
            Ohne Adresse läuft der Ablauf zu jedem Takt ohne Vorprüfung.
          </p>
        </section>
      )}

      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-xs font-medium text-muted-foreground">Bedingungen</p>
          <div className="flex gap-1.5">
            {(["any", "all"] as const).map((option) => (
              <button
                key={option}
                onClick={() => setMatchMode(option)}
                className={`rounded-full border px-2 py-0.5 text-[11px] ${
                  matchMode === option
                    ? "border-primary bg-accent/50"
                    : "text-muted-foreground hover:bg-secondary"
                }`}
              >
                {option === "any" ? "eine reicht" : "alle nötig"}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-1.5">
          {conditions.map((condition, index) => (
            <div key={index} className="flex items-center gap-1">
              <Input
                value={condition.path}
                onChange={(event) => patchCondition(index, { path: event.target.value })}
                placeholder="feld.pfad"
                aria-label={`Feld ${index + 1}`}
                className="h-8 flex-1 text-xs"
              />
              <select
                value={condition.op}
                onChange={(event) => patchCondition(index, { op: event.target.value as TriggerOperator })}
                aria-label={`Vergleich ${index + 1}`}
                className="h-8 rounded-md border bg-background px-1 text-xs"
              >
                {TRIGGER_OPERATORS.map((op) => (
                  <option key={op} value={op}>
                    {operatorLabel(op)}
                  </option>
                ))}
              </select>
              {NEEDS_VALUE.includes(condition.op) && (
                <Input
                  value={String(condition.value ?? "")}
                  onChange={(event) => patchCondition(index, { value: event.target.value })}
                  placeholder="Wert"
                  aria-label={`Wert ${index + 1}`}
                  className="h-8 w-20 text-xs"
                />
              )}
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    aria-label={`Bedingung ${index + 1} entfernen`}
                    className="shrink-0 rounded-md p-1.5 text-muted-foreground hover:bg-secondary"
                    onClick={() => setConditions((list) => list.filter((_, i) => i !== index))}
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent>Bedingung entfernen</TooltipContent>
              </Tooltip>
            </div>
          ))}
        </div>
        <button
          className="flex items-center gap-1 rounded-md px-1 py-1 text-[11px] text-muted-foreground hover:bg-secondary"
          onClick={() => setConditions((list) => [...list, { path: "", op: "gt", value: "" }])}
        >
          <Plus className="size-3" /> Bedingung
        </button>
        <p className="text-[11px] text-muted-foreground">
          Ohne Bedingung startet jeder Aufruf den Ablauf.
        </p>
      </section>

      <section className="space-y-2 rounded-lg border p-2.5">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-medium text-muted-foreground">Datenschutz im Verlauf</p>
          <label className="flex items-center gap-2 text-[11px] text-muted-foreground">
            Werte zeigen
            <Switch checked={logValues} onCheckedChange={setLogValues} aria-label="Geprüfte Werte im Verlauf zeigen" />
          </label>
        </div>
        <p className="text-[11px] text-muted-foreground">
          {logValues ? "Geprüfte Werte erscheinen im Verlauf." : "Geprüfte Werte erscheinen nur als •••."}
        </p>
        <div className="flex flex-wrap gap-1" aria-label="Ausgeschlossene Felder">
          {excludeList.map((path) => {
            const info = preview.patterns.find((p) => p.pattern === path);
            const bad = Boolean(info?.error);
            const none = !bad && !preview.error && info && info.hits.length === 0;
            return (
              <span
                key={path}
                className={`flex items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-[11px] ${
                  bad ? "border-destructive text-destructive" : none ? "border-dashed text-muted-foreground" : "bg-secondary"
                }`}
              >
                {path}
                {info && !bad && !preview.error && <span className="text-muted-foreground">· {info.hits.length}</span>}
                <button
                  aria-label={`${path} nicht mehr ausschließen`}
                  className="text-muted-foreground hover:text-foreground"
                  onClick={() => setLogExclude(excludeList.filter((p) => p !== path).join(", "))}
                >
                  ×
                </button>
              </span>
            );
          })}
        </div>
        <Input
          value={excludeDraft}
          onChange={(e) => setExcludeDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === ",") {
              e.preventDefault();
              addExclude();
            }
          }}
          onBlur={() => !draftError && addExclude()}
          placeholder="Feld ausschließen, z. B. users[*].email"
          aria-label="Sensibles Feld vom Verlauf ausschließen"
          aria-invalid={Boolean(draftError)}
          aria-describedby="exclude-hint"
          className={`h-8 font-mono text-xs ${draftError ? "border-destructive" : ""}`}
        />
        <div id="exclude-hint" aria-live="polite" className="space-y-0.5 text-[11px]">
          {draftError && <p className="text-destructive">{draftError}</p>}
          {preview.patterns
            .filter((p) => p.error || (!preview.error && p.hits.length === 0))
            .map((p) => (
              <p key={p.pattern} className={p.error ? "text-destructive" : "text-muted-foreground"}>
                <code>{p.pattern}</code>:{" "}
                {p.error ?? "trifft in den Beispieldaten kein Feld. Pfad oder Listenplatz prüfen."}
              </p>
            ))}
          {!preview.error &&
            preview.patterns
              .filter((p) => p.hits.length)
              .map((p) => (
                <p key={p.pattern} className="text-muted-foreground">
                  <code>{p.pattern}</code> trifft: <code>{p.hits.slice(0, 4).join(", ")}</code>
                  {p.hits.length > 4 ? ` +${p.hits.length - 4}` : ""}
                </p>
              ))}
        </div>
        <p className="text-[11px] text-muted-foreground">
          Enter fügt hinzu. <code>*</code> = eine Ebene oder ein Listenplatz, <code>**</code> = beliebig tief,{" "}
          <code>[0]</code> = genau ein Platz. Unterfelder werden mit ausgeschlossen.
        </p>
      </section>

      <section className="space-y-2">
        <p className="text-xs font-medium text-muted-foreground">Vorschau mit Beispieldaten</p>
        <div className="flex flex-wrap gap-1.5" aria-label="Beispiel wählen">
          {SAMPLES.map((s) => (
            <button
              key={s.label}
              onClick={() => setSample(JSON.stringify(s.data, null, 2))}
              className="rounded-full border px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-secondary"
              title={s.hint}
            >
              {s.label}
            </button>
          ))}
        </div>
        <Textarea
          value={sample}
          onChange={(event) => setSample(event.target.value)}
          className="min-h-24 font-mono text-[11px]"
          aria-label="Beispielnachricht"
        />
        <p className="text-[11px] text-muted-foreground">
          Läuft nur in deinem Browser. Nichts wird gesendet, gespeichert oder protokolliert.
        </p>
        {preview.error ? (
          <p className="text-[11px] text-destructive">{preview.error}</p>
        ) : preview.check ? (
          <div className="space-y-2 rounded-md border p-2 text-xs" aria-live="polite">
            <p className={preview.check.fired ? "font-medium text-primary" : "font-medium text-muted-foreground"}>
              {preview.check.fired ? "Ablauf würde starten" : "Ablauf würde übersprungen"}
            </p>
            <div>
              <p className="text-[11px] font-medium text-muted-foreground">So steht es im Verlauf</p>
              <p className="break-words font-mono text-[11px]">{preview.reason}</p>
            </div>
            <div>
              <p className="text-[11px] font-medium text-muted-foreground">
                Nachricht nach Ausschluss ({preview.hidden} Feld(er) entfernt)
              </p>
              <pre className="max-h-40 overflow-auto rounded bg-secondary p-1.5 text-[10px]">{preview.redacted}</pre>
            </div>
          </div>
        ) : null}
      </section>

      <section className="space-y-2 border-t pt-3">
        <Button size="sm" onClick={() => save.mutate()} disabled={!boardId || save.isPending}>
          {existing ? "Änderungen speichern" : "Auslöser anlegen"}
        </Button>

        {existing && (
          <div className="space-y-2">
            <div>
              <p className="mb-1 text-xs font-medium text-muted-foreground">Adresse für Ereignisse</p>
              <div className="flex items-center gap-1">
                <Input readOnly value={webhookUrl} className="h-8 font-mono text-[11px]" />
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      aria-label="Adresse kopieren"
                      className="shrink-0 rounded-md p-1.5 text-muted-foreground hover:bg-secondary"
                      onClick={() => {
                        navigator.clipboard.writeText(webhookUrl);
                        toast.success("Adresse kopiert.");
                      }}
                    >
                      <Copy className="size-3.5" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>Adresse kopieren</TooltipContent>
                </Tooltip>
              </div>
            </div>

            {secret ? (
              <div className="rounded-md border border-primary/40 bg-accent/30 p-2">
                <p className="text-[11px] text-muted-foreground">
                  Schlüssel – wird nur jetzt angezeigt. Als Kopfzeile senden:
                  <code className="ml-1">Authorization: Bearer …</code>
                </p>
                <code className="mt-1 block break-all font-mono text-[11px]">{secret}</code>
              </div>
            ) : (
              <p className="text-[11px] text-muted-foreground">
                Schlüssel beginnt mit {existing.prefix}… und wird nicht erneut angezeigt.
              </p>
            )}

            <p className="text-[11px] text-muted-foreground">
              Letzter Stand: {existing.last_status ?? "noch kein Ereignis"}
              {existing.last_detail ? ` – ${existing.last_detail}` : ""}
            </p>

            <div className="flex gap-1.5">
              <Button size="sm" variant="secondary" onClick={() => rotate.mutate()}>
                <RotateCcw className="mr-1 size-3.5" /> Neuer Schlüssel
              </Button>
              <Button size="sm" variant="ghost" onClick={() => remove.mutate()}>
                <Trash2 className="mr-1 size-3.5" /> Entfernen
              </Button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
