import { unzipSync, strFromU8 } from "fflate";

/** One selectable piece of a source: a PDF page, a slide, a text block or a transcript chunk. */
export type Segment = {
  id: string;
  label: string;
  text: string;
  thumb?: string;
  start?: number;
};

const MAX_THUMBS = 24;

/** Split an uploaded file into selectable segments (with page images for PDFs). */
export async function segmentsFromFile(file: File, fallbackText: string): Promise<Segment[]> {
  const name = file.name.toLowerCase();
  try {
    if (name.endsWith(".pdf")) return await pdfSegments(file);
    if (name.endsWith(".pptx")) return pptxSegments(await file.arrayBuffer());
  } catch {
    /* fall back to plain text blocks */
  }
  return textSegments(fallbackText);
}

export async function pdfSegments(file: Blob): Promise<Segment[]> {
  const { getDocumentProxy, extractText } = await import("unpdf");
  const buffer = new Uint8Array(await file.arrayBuffer());
  const pdf = await getDocumentProxy(buffer);
  const { text } = await extractText(pdf, { mergePages: false });
  const pages = Array.isArray(text) ? text : [String(text)];

  const segments: Segment[] = [];
  for (let index = 0; index < pages.length; index += 1) {
    const thumb = index < MAX_THUMBS ? await renderPage(pdf, index + 1) : undefined;
    segments.push({
      id: `p${index + 1}`,
      label: `Seite ${index + 1}`,
      text: (pages[index] ?? "").trim(),
      ...(thumb ? { thumb } : {}),
    });
  }
  return segments;
}

async function renderPage(pdf: unknown, pageNumber: number): Promise<string | undefined> {
  try {
    const document = pdf as { getPage: (n: number) => Promise<PdfPage> };
    const page = await document.getPage(pageNumber);
    const base = page.getViewport({ scale: 1 });
    const scale = Math.min(320 / base.width, 2);
    const viewport = page.getViewport({ scale });
    const canvas = window.document.createElement("canvas");
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    const context = canvas.getContext("2d");
    if (!context) return undefined;
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvas, canvasContext: context, viewport }).promise;
    return canvas.toDataURL("image/jpeg", 0.55);
  } catch {
    return undefined;
  }
}

type PdfPage = {
  getViewport: (options: { scale: number }) => { width: number; height: number };
  render: (options: Record<string, unknown>) => { promise: Promise<void> };
};

function pptxSegments(buffer: ArrayBuffer): Segment[] {
  const files = unzipSync(new Uint8Array(buffer));
  const slides = Object.keys(files)
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => slideIndex(a) - slideIndex(b));

  return slides.map((slideName, index) => {
    const xml = strFromU8(files[slideName]!);
    const parts = [...xml.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map((m) => decodeXml(m[1] ?? ""));
    return {
      id: `s${index + 1}`,
      label: `Folie ${index + 1}`,
      text: parts.join("\n").trim(),
    };
  });
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

/** Plain text split into readable blocks of roughly 1.500 characters. */
export function textSegments(text: string, size = 1500): Segment[] {
  const clean = (text ?? "").trim();
  if (!clean) return [];

  const slideMatches = clean.split(/\n(?=## Folie \d+)/g);
  if (slideMatches.length > 1) {
    return slideMatches.map((block, index) => ({
      id: `s${index + 1}`,
      label: block.match(/## (Folie \d+)/)?.[1] ?? `Abschnitt ${index + 1}`,
      text: block.replace(/^## Folie \d+\n?/, "").trim(),
    }));
  }

  const blocks: string[] = [];
  let current = "";
  for (const paragraph of clean.split(/\n{2,}/)) {
    if (current && current.length + paragraph.length > size) {
      blocks.push(current.trim());
      current = "";
    }
    current += (current ? "\n\n" : "") + paragraph;
    while (current.length > size * 1.8) {
      blocks.push(current.slice(0, size).trim());
      current = current.slice(size);
    }
  }
  if (current.trim()) blocks.push(current.trim());

  return blocks.map((block, index) => ({
    id: `b${index + 1}`,
    label: `Abschnitt ${index + 1}`,
    text: block,
  }));
}

/** Segments stored on a module, or derived from its text on the fly. */
export function storedSegments(metadata: Record<string, unknown> | null): Segment[] | null {
  const raw = metadata?.["segments"];
  if (!Array.isArray(raw) || raw.length === 0) return null;
  return raw as Segment[];
}

export function formatTime(seconds: number) {
  const total = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  return `${minutes}:${String(rest).padStart(2, "0")}`;
}
