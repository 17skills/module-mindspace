import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { loadAiKeyConfig, runStructured, runTranscription } from "@/lib/ai-keys.server";

function decodeEntities(value: string) {
  return value
    .replace(/&amp;#39;/g, "'")
    .replace(/&amp;quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

/** YouTube metadata + transcript (when captions exist). */
export const fetchYoutube = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ url: z.string().url() }).parse(input))
  .handler(async ({ data }) => {
    const videoId = data.url.match(
      /(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([A-Za-z0-9_-]{6,})/,
    )?.[1];
    if (!videoId) throw new Error("Keine gültige YouTube-URL");

    let title = "YouTube-Video";
    let author = "";
    try {
      const oembed = await fetch(
        `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`,
      );
      if (oembed.ok) {
        const meta = (await oembed.json()) as { title?: string; author_name?: string };
        title = meta.title ?? title;
        author = meta.author_name ?? "";
      }
    } catch {
      /* Titel bleibt generisch */
    }

    let transcript = "";
    let segments: TimedSegment[] = [];
    let transcriptError: string | null = null;
    try {
      const result = await youtubeTranscript(videoId);
      transcript = result.text;
      segments = result.segments;
    } catch (error) {
      transcriptError = error instanceof Error ? error.message : "Transkript nicht verfügbar";
    }

    return {
      videoId,
      title,
      author,
      thumbnail: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
      transcript,
      segments,
      transcriptError,
    };
  });

export type TimedSegment = { id: string; label: string; text: string; start: number };

/** Group caption lines into readable chunks of about 45 seconds. */
function chunkByTime(lines: { start: number; text: string }[]): TimedSegment[] {
  const chunks: TimedSegment[] = [];
  let buffer = "";
  let start = lines[0]?.start ?? 0;

  for (const line of lines) {
    if (buffer && (line.start - start > 45 || buffer.length > 900)) {
      chunks.push({
        id: `t${chunks.length + 1}`,
        label: timeLabel(start),
        text: buffer.trim(),
        start,
      });
      buffer = "";
      start = line.start;
    }
    buffer += (buffer ? " " : "") + line.text;
  }
  if (buffer.trim()) {
    chunks.push({
      id: `t${chunks.length + 1}`,
      label: timeLabel(start),
      text: buffer.trim(),
      start,
    });
  }
  return chunks;
}

function timeLabel(seconds: number) {
  const total = Math.max(0, Math.round(seconds));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

async function youtubeTranscript(videoId: string): Promise<{
  text: string;
  segments: TimedSegment[];
}> {
  const page = await fetch(`https://www.youtube.com/watch?v=${videoId}&hl=de`, {
    headers: {
      "user-agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
      "accept-language": "de,en;q=0.8",
    },
  });
  const html = await page.text();
  const tracksRaw = html.match(/"captionTracks":(\[.*?\])/s)?.[1];
  if (!tracksRaw) throw new Error("Für dieses Video gibt es keine Untertitel");

  const tracks = JSON.parse(tracksRaw.replace(/\\u0026/g, "&")) as {
    baseUrl: string;
    languageCode?: string;
    kind?: string;
  }[];
  const track =
    tracks.find((t) => t.languageCode?.startsWith("de")) ??
    tracks.find((t) => t.languageCode?.startsWith("en")) ??
    tracks[0];
  if (!track) throw new Error("Für dieses Video gibt es keine Untertitel");

  const xmlResponse = await fetch(decodeEntities(track.baseUrl));
  const xml = await xmlResponse.text();
  const lines = [...xml.matchAll(/<text[^>]*start="([\d.]+)"[^>]*>([\s\S]*?)<\/text>/g)]
    .map((m) => ({
      start: Number(m[1] ?? 0),
      text: decodeEntities(m[2] ?? "")
        .replace(/\s+/g, " ")
        .trim(),
    }))
    .filter((line) => line.text);

  const text = lines.map((line) => line.text).join(" ");
  if (!text) throw new Error("Untertitel sind leer");
  return { text, segments: chunkByTime(lines) };
}

/** Podcast/audio transcription through Lovable AI. */
export const transcribeAudio = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({
        audioUrl: z.string().url().optional(),
        audioBase64: z.string().optional(),
        mimeType: z.string().default("audio/mpeg"),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    let bytes: ArrayBuffer;
    let mime = data.mimeType;

    if (data.audioUrl) {
      const res = await fetch(data.audioUrl);
      if (!res.ok) throw new Error(`Audio konnte nicht geladen werden (${res.status})`);
      mime = res.headers.get("content-type")?.split(";")[0] ?? mime;
      bytes = await res.arrayBuffer();
    } else if (data.audioBase64) {
      const binary = atob(data.audioBase64);
      const buffer = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i += 1) buffer[i] = binary.charCodeAt(i);
      bytes = buffer.buffer;
    } else {
      throw new Error("Keine Audioquelle angegeben");
    }

    if (bytes.byteLength > 80 * 1024 * 1024) {
      throw new Error("Audiodatei ist zu groß (max. 80 MB)");
    }

    // Eigener OpenAI-/Google-Schlüssel (BYOK), sonst Lovable AI.
    const cfg = await loadAiKeyConfig(context.supabase, context.userId);
    const result = await runTranscription(cfg, { bytes, mime });
    const lines = result.segments.filter((line) => line.text);
    return { text: result.text, segments: lines.length ? chunkByTime(lines) : [] };
  });

function ogImage(html: string): string | null {
  const match =
    html.match(/<meta[^>]+property="og:image"[^>]+content="([^"]+)"/i) ??
    html.match(/<meta[^>]+content="([^"]+)"[^>]+property="og:image"/i) ??
    html.match(/<meta[^>]+name="twitter:image"[^>]+content="([^"]+)"/i) ??
    html.match(/<itunes:image[^>]+href="([^"]+)"/i) ??
    html.match(/<url>(https?:\/\/[^<]+\.(?:jpg|jpeg|png|webp))<\/url>/i);
  return match?.[1] ? decodeEntities(match[1]) : null;
}

/** Resolve a podcast episode page or RSS feed to an audio file + metadata. */
export const resolvePodcast = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ url: z.string().url() }).parse(input))
  .handler(async ({ data }) => {
    const res = await fetch(data.url, {
      headers: { "user-agent": "Mozilla/5.0 CanvasSpark/1.0", accept: "*/*" },
    });
    if (!res.ok) throw new Error(`Seite konnte nicht geladen werden (${res.status})`);
    const contentType = res.headers.get("content-type") ?? "";

    if (contentType.includes("audio/")) {
      return {
        title: data.url.split("/").pop() ?? "Audio",
        audioUrl: data.url,
        image: null as string | null,
      };
    }

    const body = await res.text();

    if (contentType.includes("xml") || body.trimStart().startsWith("<?xml")) {
      const item = body.match(/<item[\s\S]*?<\/item>/)?.[0] ?? body;
      const title = decodeEntities(
        item.match(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/)?.[1]?.trim() ??
          "Podcast-Episode",
      );
      const audioUrl = item.match(/<enclosure[^>]*url="([^"]+)"/)?.[1];
      if (!audioUrl) throw new Error("Im Feed wurde keine Audiodatei gefunden");
      return {
        title,
        audioUrl: decodeEntities(audioUrl),
        image: ogImage(item) ?? ogImage(body),
      };
    }

    const title = decodeEntities(
      body.match(/<meta property="og:title" content="([^"]+)"/)?.[1] ??
        body.match(/<title>([\s\S]*?)<\/title>/)?.[1]?.trim() ??
        "Podcast-Episode",
    );
    const audioUrl =
      body.match(/<meta property="og:audio" content="([^"]+)"/)?.[1] ??
      body.match(/https?:\/\/[^"'\s]+\.mp3/)?.[0];
    if (!audioUrl) throw new Error("Auf dieser Seite wurde keine Audiodatei gefunden");
    return { title, audioUrl: decodeEntities(audioUrl), image: ogImage(body) };
  });

function metaContent(html: string, keys: string[]): string | null {
  for (const key of keys) {
    const match =
      html.match(
        new RegExp(`<meta[^>]+(?:property|name)="${key}"[^>]+content="([^"]*)"`, "i"),
      ) ??
      html.match(
        new RegExp(`<meta[^>]+content="([^"]*)"[^>]+(?:property|name)="${key}"`, "i"),
      );
    const value = match?.[1]?.trim();
    if (value) return decodeEntities(value);
  }
  return null;
}

/**
 * Only the public card data of a page (name, tagline, picture) — never body text.
 * Used for social profile links so nothing unreadable ends up as chat context.
 */
export const fetchLinkMeta = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ url: z.string().url() }).parse(input))
  .handler(async ({ data }) => {
    let title: string | null = null;
    let description: string | null = null;
    let image: string | null = null;
    try {
      const res = await fetch(data.url, {
        headers: {
          "user-agent":
            "Mozilla/5.0 (compatible; facebookexternalhit/1.1; +http://www.facebook.com/externalhit_uatext.php)",
          "accept-language": "de,en;q=0.8",
        },
      });
      if (res.ok) {
        const html = (await res.text()).slice(0, 400_000);
        title =
          metaContent(html, ["og:title", "twitter:title"]) ??
          decodeEntities(html.match(/<title>([\s\S]*?)<\/title>/)?.[1]?.trim() ?? "") ??
          null;
        description = metaContent(html, ["og:description", "twitter:description", "description"]);
        image = metaContent(html, ["og:image", "og:image:secure_url", "twitter:image"]);
        if (image && !/^https?:\/\//i.test(image)) {
          try {
            image = new URL(image, data.url).toString();
          } catch {
            image = null;
          }
        }
      }
    } catch {
      /* Vorschau bleibt leer */
    }
    return { title: title || null, description, image };
  });

/** Plain page text for any other link. */
export const fetchPageText = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ url: z.string().url() }).parse(input))
  .handler(async ({ data }) => {
    const res = await fetch(data.url, { headers: { "user-agent": "Mozilla/5.0 CanvasSpark/1.0" } });
    if (!res.ok) throw new Error(`Seite konnte nicht geladen werden (${res.status})`);
    const html = await res.text();
    const title = decodeEntities(html.match(/<title>([\s\S]*?)<\/title>/)?.[1]?.trim() ?? data.url);
    const text = decodeEntities(
      html
        .replace(/<script[\s\S]*?<\/script>/g, " ")
        .replace(/<style[\s\S]*?<\/style>/g, " ")
        .replace(/<noscript[\s\S]*?<\/noscript>/g, " ")
        .replace(/<svg[\s\S]*?<\/svg>/g, " ")
        .replace(/<(nav|header|footer|form|aside)[\s\S]*?<\/\1>/gi, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim(),
    ).slice(0, 120_000);


    let image = ogImage(html);
    if (image && !/^https?:\/\//i.test(image)) {
      try {
        image = new URL(image, data.url).toString();
      } catch {
        image = null;
      }
    }
    return { title, text, image };
  });

const StructureSchema = z.object({
  items: z.array(
    z.object({
      kind: z.enum(["table", "list", "chart"]),
      title: z.string(),
      chartType: z.enum(["bar", "line", "pie", "none"]),
      columns: z.array(z.string()),
      rows: z.array(z.array(z.string())),
    }),
  ),
});

export type StructuredItem = z.infer<typeof StructureSchema>["items"][number];

/** Pull tables, lists and chartable series out of a module's text. */
export const extractStructured = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({
        text: z.string().min(1),
        title: z.string().optional(),
        instruction: z.string().optional(),
        kind: z.enum(["auto", "table", "list", "chart"]).optional(),
        max: z.number().int().min(1).max(6).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const limit = data.max ?? 6;
    const kindRule =
      data.kind && data.kind !== "auto"
        ? `- Gib ausschließlich Einträge mit kind "${data.kind}" zurück.`
        : "";
    const instructionRule = data.instruction?.trim()
      ? `\nAnweisung der Nutzerin/des Nutzers (hat Vorrang):\n${data.instruction.trim()}\n`
      : "";

    const prompt = `Analysiere den folgenden Inhalt und gib die enthaltenen strukturierten Daten zurück.
Erlaubt sind bis zu ${limit} Einträge. Regeln:
- kind "table" für tabellarische Daten (columns = Spaltenköpfe, rows = Zeilen).
- kind "list" für Aufzählungen (columns = ["Punkt"], jede Zeile ein Eintrag).
- kind "chart" für Zahlenreihen, die sich visualisieren lassen (columns = ["Kategorie","Wert"], Werte als Zahl-Text).
- chartType nur bei kind "chart" setzen (bar, line oder pie), sonst "none".
- Erfinde keine Daten. Wenn nichts Strukturierbares vorhanden ist, gib eine leere Liste zurück.
${kindRule}${instructionRule}
Titel: ${data.title ?? "Unbenannt"}

Inhalt:
${data.text.slice(0, 120_000)}`;

    const cfg = await loadAiKeyConfig(context.supabase, context.userId);
    const text = await runStructured(cfg, {
      fn: "extract",
      prompt,
      schemaName: "structures",
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          items: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                kind: { type: "string", enum: ["table", "list", "chart"] },
                title: { type: "string" },
                chartType: { type: "string", enum: ["bar", "line", "pie", "none"] },
                columns: { type: "array", items: { type: "string" } },
                rows: {
                  type: "array",
                  items: { type: "array", items: { type: "string" } },
                },
              },
              required: ["kind", "title", "chartType", "columns", "rows"],
            },
          },
        },
        required: ["items"],
      },
    });

    try {
      return StructureSchema.parse(JSON.parse(text));
    } catch {
      throw new Error("Es konnten keine strukturierten Daten gelesen werden");
    }
  });
