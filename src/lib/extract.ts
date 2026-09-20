import { unzipSync, strFromU8 } from "fflate";

/** Extracted plain text from an uploaded file, done in the browser. */
export async function extractFileText(file: File): Promise<string> {
  const name = file.name.toLowerCase();

  if (name.endsWith(".txt") || name.endsWith(".md") || name.endsWith(".markdown")) {
    return await file.text();
  }

  if (name.endsWith(".pdf")) {
    const { extractText, getDocumentProxy } = await import("unpdf");
    const buffer = new Uint8Array(await file.arrayBuffer());
    const pdf = await getDocumentProxy(buffer);
    const { text } = await extractText(pdf, { mergePages: true });
    return typeof text === "string" ? text : text.join("\n\n");
  }

  if (name.endsWith(".pptx")) {
    const buffer = new Uint8Array(await file.arrayBuffer());
    const files = unzipSync(buffer);
    const slideNames = Object.keys(files)
      .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
      .sort((a, b) => slideIndex(a) - slideIndex(b));

    return slideNames
      .map((slideName, index) => {
        const xml = strFromU8(files[slideName]!);
        const parts = [...xml.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map((m) =>
          decodeXml(m[1] ?? ""),
        );
        return `## Folie ${index + 1}\n${parts.join("\n")}`;
      })
      .join("\n\n");
  }

  if (name.endsWith(".docx")) {
    const buffer = new Uint8Array(await file.arrayBuffer());
    const files = unzipSync(buffer);
    const doc = files["word/document.xml"];
    if (!doc) return "";
    const xml = strFromU8(doc);
    return [...xml.matchAll(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g)]
      .map((m) => decodeXml(m[1] ?? ""))
      .join(" ");
  }

  throw new Error("Dateityp wird nicht unterstützt (PDF, PPTX, DOCX, TXT, MD)");
}

function slideIndex(name: string) {
  return Number(name.match(/slide(\d+)\.xml$/)?.[1] ?? 0);
}

function decodeXml(value: string) {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

export function isAudioFile(file: File) {
  return /\.(mp3|m4a|wav|ogg|aac|flac|webm)$/i.test(file.name) || file.type.startsWith("audio/");
}

export function youtubeId(url: string): string | null {
  const match = url.match(
    /(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([A-Za-z0-9_-]{6,})/,
  );
  return match?.[1] ?? null;
}
