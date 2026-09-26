/**
 * Zeigt ein Ergebnis-Artefakt – auf dem Canvas und in Apps identisch.
 * Fremde Adressen öffnen nur als Link; eingebettet wird nur die eigene, frisch signierte Datei.
 */
import { Download, ExternalLink } from "lucide-react";
import { Markdown } from "@/lib/markdown";
import { ARTIFACT_LABEL, type OutputArtifact } from "@/lib/output";

export function OutputView({
  artifact,
  fileUrl,
  compact = false,
}: {
  artifact: OutputArtifact;
  /** Signierte Adresse der eigenen Datei, falls vorhanden. */
  fileUrl: string | null;
  compact?: boolean;
}) {
  const own = artifact.hasFile ? fileUrl : null;
  const src = own ?? artifact.url;

  if (artifact.kind === "empty") {
    return (
      <p className="text-sm text-muted-foreground">
        Noch kein Ergebnis. Verbinden Sie eine Karte mit diesem Ausgang.
      </p>
    );
  }
  if (artifact.hasFile && !own) {
    return <p className="text-sm text-muted-foreground">Ergebnis wird geladen …</p>;
  }

  const media = compact ? "max-h-60" : "max-h-[70vh]";

  if (artifact.kind === "image" && src) {
    return (
      <img
        src={src}
        alt={artifact.title}
        loading="lazy"
        referrerPolicy="no-referrer"
        className={`w-full rounded-md object-contain ${media}`}
      />
    );
  }
  if (artifact.kind === "video" && src) {
    return <video src={src} controls preload="metadata" className={`w-full rounded-md ${media}`} />;
  }
  if (artifact.kind === "audio" && src) {
    return <audio src={src} controls preload="metadata" className="w-full" />;
  }
  if (artifact.kind === "pdf" && own) {
    return (
      <iframe
        src={own}
        title={artifact.title}
        className={`w-full rounded-md border ${compact ? "h-60" : "h-[70vh]"}`}
      />
    );
  }
  if (artifact.kind === "text") {
    return (
      <div className="prose prose-sm max-w-none text-left text-sm">
        <Markdown source={compact ? artifact.text.slice(0, 1500) : artifact.text} />
      </div>
    );
  }
  if (src) {
    const download = artifact.kind === "model3d" || artifact.kind === "slides" || artifact.kind === "pdf";
    return (
      <div className="space-y-2 text-sm">
        <p className="text-muted-foreground">
          {ARTIFACT_LABEL[artifact.kind]}
          {artifact.kind === "model3d" || artifact.kind === "slides"
            ? " – Vorschau im Browser folgt, bis dahin öffnen oder herunterladen."
            : ""}
        </p>
        <a
          href={src}
          target="_blank"
          rel="noopener noreferrer"
          className="nodrag inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 font-medium hover:bg-accent"
        >
          {download ? <Download className="size-4" /> : <ExternalLink className="size-4" />}
          {download ? "Öffnen / herunterladen" : "Öffnen"}
        </a>
      </div>
    );
  }
  return <p className="text-sm text-muted-foreground">Dieses Ergebnis lässt sich nicht anzeigen.</p>;
}
