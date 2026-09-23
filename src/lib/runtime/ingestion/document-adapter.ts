/**
 * Free text ingestion: notes, markdown, transcripts, mail bodies.
 * Text keeps its shape; only headings are used to build sections.
 */
import type { TextSection, UnstructuredText } from "@/lib/runtime/source-protocol";

export function splitSections(text: string): TextSection[] {
  const lines = text.split(/\r?\n/);
  const sections: TextSection[] = [];
  let heading: string | null = null;
  let body: string[] = [];

  const flush = () => {
    const content = body.join("\n").trim();
    if (heading != null || content) sections.push({ heading, body: content });
    body = [];
  };

  for (const line of lines) {
    const match = /^(#{1,6})\s+(.*)$/.exec(line);
    if (match) {
      flush();
      heading = match[2]!.trim();
    } else {
      body.push(line);
    }
  }
  flush();
  return sections.length ? sections : [{ heading: null, body: text.trim() }];
}

export function buildDocument(text: string): UnstructuredText {
  const clean = text.replace(/\u0000/g, "").trim();
  const words = clean ? clean.split(/\s+/).length : 0;
  return { text: clean, sections: splitSections(clean), wordCount: words };
}
