/**
 * Ergebnis-Modul: ein fest verkabelter Ausgang.
 *
 * Es erzeugt keine Karten. Es zeigt das Ergebnis der verbundenen Karte als
 * typisiertes Artefakt (Bild, Video, Audio, PDF, 3D, Text, Link) – auf dem
 * Canvas und identisch in jeder App. Tauscht man den Motor davor, bleibt der
 * Ausgang gleich.
 */
import type { NodeRecord } from "@/components/canvas/board-context";

export type ArtifactKind =
  | "image"
  | "video"
  | "audio"
  | "pdf"
  | "model3d"
  | "slides"
  | "text"
  | "link"
  | "empty";

export type OutputArtifact = {
  kind: ArtifactKind;
  title: string;
  /** Nur https – fremde Adressen, nie javascript:/data:. */
  url: string | null;
  /** Datei im eigenen Speicher; die Adresse wird beim Anzeigen frisch signiert. */
  hasFile: boolean;
  mime: string | null;
  text: string;
  sourceId: string | null;
  capturedAt: string | null;
};

export const ARTIFACT_LABEL: Record<ArtifactKind, string> = {
  image: "Bild",
  video: "Video",
  audio: "Audio",
  pdf: "PDF",
  model3d: "3D-Modell",
  slides: "Folien",
  text: "Bericht",
  link: "Link",
  empty: "Noch kein Ergebnis",
};

export const EMPTY_ARTIFACT: OutputArtifact = {
  kind: "empty",
  title: "",
  url: null,
  hasFile: false,
  mime: null,
  text: "",
  sourceId: null,
  capturedAt: null,
};

const MAX_TEXT = 20_000;

export function safeUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

/** Erkennt die Artefaktart aus MIME-Typ, Dateiname oder Adresse. */
export function kindOf(mime: string | null, name: string, hasContent: boolean): ArtifactKind {
  const m = (mime ?? "").toLowerCase();
  const n = name.toLowerCase().split("?")[0] ?? "";
  if (m.startsWith("image/") || /\.(png|jpe?g|gif|webp|avif|svg)$/.test(n)) return "image";
  if (m.startsWith("video/") || /\.(mp4|webm|mov)$/.test(n)) return "video";
  if (m.startsWith("audio/") || /\.(mp3|wav|m4a|ogg)$/.test(n)) return "audio";
  if (m === "application/pdf" || n.endsWith(".pdf")) return "pdf";
  if (m.startsWith("model/") || /\.(glb|gltf|usdz|obj|stl)$/.test(n)) return "model3d";
  if (m.includes("presentation") || /\.(pptx?|key|odp)$/.test(n)) return "slides";
  if (n.startsWith("https://")) return "link";
  return hasContent ? "text" : "empty";
}

/** Momentaufnahme der verbundenen Karte als Artefakt. */
export function artifactFrom(record: NodeRecord | null, now = new Date()): OutputArtifact {
  if (!record) return EMPTY_ARTIFACT;
  const url = safeUrl(record.source_url);
  const hasFile = Boolean(record.storage_path);
  const text = (record.content ?? "").slice(0, MAX_TEXT);
  const name = record.storage_path ?? url ?? record.title ?? "";
  const kind = kindOf(record.mime_type, name, Boolean(text.trim()));
  return {
    kind: kind === "link" && !url ? "empty" : kind,
    title: record.title?.trim() || ARTIFACT_LABEL[kind],
    url,
    hasFile,
    mime: record.mime_type,
    text,
    sourceId: record.id,
    capturedAt: now.toISOString(),
  };
}

export function readOutput(metadata: Record<string, unknown> | null): OutputArtifact {
  const raw = metadata?.["output"];
  if (!raw || typeof raw !== "object") return EMPTY_ARTIFACT;
  const o = raw as Partial<OutputArtifact>;
  const kind = (Object.keys(ARTIFACT_LABEL) as ArtifactKind[]).includes(o.kind as ArtifactKind)
    ? (o.kind as ArtifactKind)
    : "empty";
  return {
    kind,
    title: typeof o.title === "string" ? o.title : "",
    url: safeUrl(o.url ?? null),
    hasFile: o.hasFile === true,
    mime: typeof o.mime === "string" ? o.mime : null,
    text: typeof o.text === "string" ? o.text.slice(0, MAX_TEXT) : "",
    sourceId: typeof o.sourceId === "string" ? o.sourceId : null,
    capturedAt: typeof o.capturedAt === "string" ? o.capturedAt : null,
  };
}

/** Gleicher Inhalt? Dann nicht erneut speichern (verhindert Schreibschleifen). */
export function sameArtifact(a: OutputArtifact, b: OutputArtifact): boolean {
  return (
    a.kind === b.kind &&
    a.title === b.title &&
    a.url === b.url &&
    a.hasFile === b.hasFile &&
    a.mime === b.mime &&
    a.text === b.text &&
    a.sourceId === b.sourceId
  );
}
