/**
 * Zeigt OpenUI-Lang-Ergebnisse mit der Whitelist. Farben kommen aus den Tokens
 * der umgebenden Fläche – in einer App also aus deren Branding.
 * Aktionen lösen nur ein Signal aus (DOM-Ereignis "scope-signal"), nie eine Wirkung.
 */
import { useState } from "react";
import { Renderer } from "@openuidev/react-lang";
import { genuiLibrary } from "./library";

/** Erkennt OpenUI Lang: erste Anweisung ist `root = Komponente(`. */
export function isOpenUI(text: string): boolean {
  return /^\s*root\s*=\s*[A-Z][A-Za-z]*\(/.test(text);
}

/** Kurzregeln für Modelle, damit sie ihre Antwort als OpenUI Lang formulieren. */
export const GENUI_PROMPT_RULES = `Antworte ausschließlich in OpenUI Lang. Erste Zeile: root = Stack([...]).
Erlaubt sind nur: Stack([..]), MetricRow([..]), Metric(label, value, trend, tone), StatusBadge(text, tone),
DataTable([Kopfzeilen], [[Zellen]]), Callout(titel, text, "info"|"alert"|"check"), ActionChoice([Optionen]).
tone: "neutral"|"success"|"warning"|"destructive". Keine Links, kein HTML.`;

export function GenUIView({
  source,
  sourceId,
  onSignal,
}: {
  source: string;
  sourceId?: string | null;
  /** Optional: Signal weiterreichen (z. B. protokollieren); false = nicht bestätigt. */
  onSignal?: (choice: string) => Promise<boolean> | boolean;
}) {
  const [signal, setSignal] = useState<string | null>(null);
  return (
    <div className="genui nodrag space-y-2 text-left">
      <Renderer
        response={source}
        library={genuiLibrary}
        isStreaming={false}
        onAction={async (e) => {
          const choice = String(e.params?.["choice"] ?? e.humanFriendlyMessage ?? "");
          window.dispatchEvent(new CustomEvent("scope-signal", { detail: { choice, sourceId: sourceId ?? null } }));
          if (onSignal && !(await onSignal(choice))) return;
          setSignal(choice);
        }}
      />
      {signal && (
        <p className="text-xs text-muted-foreground" role="status">
          Signal gesendet: {signal}
        </p>
      )}
    </div>
  );
}
