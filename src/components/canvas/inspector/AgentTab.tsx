import { useEffect, useState } from "react";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useBoard, type NodeRecord } from "@/components/canvas/board-context";
import { readAgent, zoneMembers } from "@/lib/zones";
import { EngineSection } from "@/components/canvas/inspector/EngineSection";


export function AgentTab({ record }: { record: NodeRecord }) {
  const { updateNode, runAgent, agentStale, allNodes, focusNode } = useBoard();
  const agent = readAgent(record);
  const meta = (record.metadata ?? {}) as Record<string, unknown>;
  const running = meta["agentRunning"] === true;
  const members = zoneMembers(record.id, allNodes());

  const [task, setTask] = useState(agent?.task ?? "");
  const [unit, setUnit] = useState(agent?.unit ?? "");

  useEffect(() => {
    const current = readAgent(record);
    setTask(current?.task ?? "");
    setUnit(current?.unit ?? "");
  }, [record.id]); // eslint-disable-line react-hooks/exhaustive-deps

  function patch(next: Record<string, unknown>) {
    updateNode(record.id, { metadata: { ...(record.metadata ?? {}), ...next } });
  }

  const kind = agent?.kind ?? (meta["agentKind"] === "text" ? "text" : "number");

  return (
    <div className="h-full space-y-4 overflow-auto p-3 text-sm">
      <div>
        <p className="mb-1.5 text-xs font-medium text-muted-foreground">Auftrag an das Feld</p>
        <Textarea
          value={task}
          onChange={(event) => setTask(event.target.value)}
          onBlur={() => patch({ agentTask: task })}
          placeholder="z. B. Bestimme die Zielgruppengröße in Personen aus den Marktzahlen auf diesem Feld."
          className="min-h-24 text-xs"
        />
      </div>

      <div className="flex items-end gap-2">
        <div>
          <p className="mb-1.5 text-xs font-medium text-muted-foreground">Ergebnis</p>
          <div className="flex gap-1.5">
            {(["number", "text"] as const).map((option) => (
              <button
                key={option}
                onClick={() => patch({ agentKind: option })}
                className={`rounded-full border px-2.5 py-1 text-xs ${
                  kind === option ? "border-primary bg-accent/50" : "text-muted-foreground hover:bg-secondary"
                }`}
              >
                {option === "number" ? "Zahl" : "Text"}
              </button>
            ))}
          </div>
        </div>
        {kind === "number" && (
          <div className="min-w-0 flex-1">
            <p className="mb-1.5 text-xs font-medium text-muted-foreground">Einheit</p>
            <Input
              value={unit}
              onChange={(event) => setUnit(event.target.value)}
              onBlur={() => patch({ agentUnit: unit })}
              placeholder="€, Stk, %"
              className="h-8 text-xs"
            />
          </div>
        )}
      </div>

      <div className="flex items-center gap-2">
        <Button
          size="sm"
          className="rounded-full"
          disabled={running || !task.trim()}
          onClick={() => {
            patch({ agentTask: task, agentUnit: unit });
            runAgent(record.id);
          }}
        >
          <Sparkles className="mr-1.5 size-3.5" />
          {running ? "Analysiert …" : "Analysieren"}
        </Button>
        {agent && agentStale(record.id) && !running && (
          <span className="text-xs text-destructive">Inhalte haben sich geändert</span>
        )}
      </div>

      <EngineSection metadata={record.metadata as Record<string, unknown> | null} onChange={patch} />


      {agent?.result && (
        <div className="rounded-lg border border-border/70 bg-secondary/40 p-3">
          <p className="font-display text-xl font-semibold tracking-tight">
            {agent.result}
            {agent.unit ? ` ${agent.unit}` : ""}
          </p>
          {agent.reason && (
            <p className="mt-1 text-xs leading-snug text-muted-foreground">{agent.reason}</p>
          )}
          {agent.at && (
            <p className="mt-1 text-[10px] text-muted-foreground">
              Stand: {new Date(agent.at).toLocaleString("de-DE")}
            </p>
          )}
        </div>
      )}

      <div>
        <p className="mb-1.5 text-xs font-medium text-muted-foreground">
          Inhalte auf diesem Feld ({members.length})
        </p>
        {members.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            Lege Karten auf das Feld — sie werden automatisch zum Kontext des Agenten.
          </p>
        ) : (
          <ul className="space-y-0.5">
            {members.map((item) => (
              <li key={item.id}>
                <button
                  className="w-full truncate rounded-md px-1.5 py-1 text-left text-xs hover:bg-secondary"
                  onClick={() => focusNode(item.id)}
                >
                  {item.title ?? "Modul"}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
