import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { initialsOf, type PresencePeer } from "@/lib/presence";

/** Wer ist gerade mit im Scope – kleine Kreise oben rechts. */
export function PresenceBar({ peers, myColor, myName }: { peers: PresencePeer[]; myColor: string; myName: string }) {
  const visible = peers.slice(0, 5);
  const extra = peers.length - visible.length;

  return (
    <div className="flex items-center -space-x-2">
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            className="grid size-7 place-items-center rounded-full border-2 border-card text-[10px] font-semibold text-white"
            style={{ background: myColor }}
          >
            {initialsOf(myName)}
          </span>
        </TooltipTrigger>
        <TooltipContent>{myName} (du)</TooltipContent>
      </Tooltip>
      {visible.map((peer) => (
        <Tooltip key={peer.userId}>
          <TooltipTrigger asChild>
            <span
              className="grid size-7 place-items-center rounded-full border-2 border-card text-[10px] font-semibold text-white"
              style={{ background: peer.color }}
            >
              {initialsOf(peer.name)}
            </span>
          </TooltipTrigger>
          <TooltipContent>
            {peer.name}
            {peer.editing ? " · bearbeitet ein Modul" : ""}
          </TooltipContent>
        </Tooltip>
      ))}
      {extra > 0 ? (
        <span className="grid size-7 place-items-center rounded-full border-2 border-card bg-muted text-[10px] font-semibold text-muted-foreground">
          +{extra}
        </span>
      ) : null}
    </div>
  );
}
