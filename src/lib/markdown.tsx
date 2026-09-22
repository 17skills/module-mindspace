/**
 * Kleiner Markdown-Renderer für Textkarten: Überschriften, Aufzählungen,
 * nummerierte Listen, Zitate, fett/kursiv/Code und Trennlinien.
 * Bewusst schlank gehalten – kein HTML aus dem Text, nur bekannte Muster.
 */
import type { ReactNode } from "react";

/** Fett, kursiv und Inline-Code innerhalb einer Zeile. */
export function inlineMarkdown(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const pattern = /(\*\*[^*]+\*\*|__[^_]+__|\*[^*]+\*|_[^_]+_|`[^`]+`)/g;
  let last = 0;
  let key = 0;
  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > last) out.push(text.slice(last, index));
    const token = match[0];
    if (token.startsWith("**") || token.startsWith("__")) {
      out.push(<strong key={key++}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith("`")) {
      out.push(
        <code key={key++} className="rounded bg-secondary px-1 font-mono text-[0.9em]">
          {token.slice(1, -1)}
        </code>,
      );
    } else {
      out.push(<em key={key++}>{token.slice(1, -1)}</em>);
    }
    last = index + token.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

type Block =
  | { kind: "heading"; level: 1 | 2 | 3; text: string }
  | { kind: "bullets"; items: string[] }
  | { kind: "numbers"; items: string[]; start: number }
  | { kind: "quote"; text: string }
  | { kind: "rule" }
  | { kind: "paragraph"; text: string };

/** Zerlegt Markdown-Text in Blöcke. */
export function markdownBlocks(source: string): Block[] {
  const blocks: Block[] = [];
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  let index = 0;
  while (index < lines.length) {
    const line = lines[index] ?? "";
    const trimmed = line.trim();
    if (!trimmed) {
      index += 1;
      continue;
    }
    const heading = trimmed.match(/^(#{1,3})\s+(.*)$/);
    if (heading) {
      blocks.push({
        kind: "heading",
        level: heading[1]!.length as 1 | 2 | 3,
        text: heading[2]!.trim(),
      });
      index += 1;
      continue;
    }
    if (/^([-*_])\1{2,}$/.test(trimmed)) {
      blocks.push({ kind: "rule" });
      index += 1;
      continue;
    }
    if (/^[-*+]\s+/.test(trimmed)) {
      const items: string[] = [];
      while (index < lines.length && /^\s*[-*+]\s+/.test(lines[index] ?? "")) {
        items.push((lines[index] ?? "").replace(/^\s*[-*+]\s+/, "").trim());
        index += 1;
      }
      blocks.push({ kind: "bullets", items });
      continue;
    }
    const numbered = trimmed.match(/^(\d+)[.)]\s+/);
    if (numbered) {
      const items: string[] = [];
      const start = Number(numbered[1]);
      while (index < lines.length && /^\s*\d+[.)]\s+/.test(lines[index] ?? "")) {
        items.push((lines[index] ?? "").replace(/^\s*\d+[.)]\s+/, "").trim());
        index += 1;
      }
      blocks.push({ kind: "numbers", items, start: Number.isFinite(start) ? start : 1 });
      continue;
    }
    if (trimmed.startsWith(">")) {
      const parts: string[] = [];
      while (index < lines.length && (lines[index] ?? "").trim().startsWith(">")) {
        parts.push((lines[index] ?? "").trim().replace(/^>\s?/, ""));
        index += 1;
      }
      blocks.push({ kind: "quote", text: parts.join(" ") });
      continue;
    }
    const parts: string[] = [];
    while (index < lines.length) {
      const current = (lines[index] ?? "").trim();
      if (
        !current ||
        /^(#{1,3})\s+/.test(current) ||
        /^[-*+]\s+/.test(current) ||
        /^\d+[.)]\s+/.test(current) ||
        current.startsWith(">")
      ) {
        break;
      }
      parts.push(current);
      index += 1;
    }
    blocks.push({ kind: "paragraph", text: parts.join(" ") });
  }
  return blocks;
}

/** Rendert Markdown-Text als React-Inhalt. */
export function Markdown({ source }: { source: string }) {
  const blocks = markdownBlocks(source);
  return (
    <div className="space-y-1.5">
      {blocks.map((block, index) => {
        switch (block.kind) {
          case "heading": {
            const size =
              block.level === 1
                ? "text-[1.35em] font-semibold"
                : block.level === 2
                  ? "text-[1.15em] font-semibold"
                  : "text-[1em] font-semibold uppercase tracking-wide";
            return (
              <p key={index} className={size}>
                {inlineMarkdown(block.text)}
              </p>
            );
          }
          case "bullets":
            return (
              <ul key={index} className="list-disc space-y-0.5 pl-5">
                {block.items.map((item, itemIndex) => (
                  <li key={itemIndex}>{inlineMarkdown(item)}</li>
                ))}
              </ul>
            );
          case "numbers":
            return (
              <ol key={index} start={block.start} className="list-decimal space-y-0.5 pl-5">
                {block.items.map((item, itemIndex) => (
                  <li key={itemIndex}>{inlineMarkdown(item)}</li>
                ))}
              </ol>
            );
          case "quote":
            return (
              <p key={index} className="border-l-2 border-border/70 pl-2 italic opacity-80">
                {inlineMarkdown(block.text)}
              </p>
            );
          case "rule":
            return <hr key={index} className="border-border/60" />;
          default:
            return <p key={index}>{inlineMarkdown(block.text)}</p>;
        }
      })}
    </div>
  );
}
