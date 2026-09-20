import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const GATEWAY = "https://ai.gateway.lovable.dev/v1";

function apiKey() {
  const key = process.env["LOVABLE_API_KEY"];
  if (!key) throw new Error("LOVABLE_API_KEY fehlt");
  return key;
}

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
  .inputValidator((input: unknown) => z.object({ url: z.string().url() }).parse(input))
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
  .inputValidator((input: unknown) =>
    z
      .object({
        audioUrl: z.string().url().optional(),
        audioBase64: z.string().optional(),
        mimeType: z.string().default("audio/mpeg"),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
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

    const form = new FormData();
    form.append("file", new Blob([bytes], { type: mime }), "audio");
    form.append("model", "google/gemini-3.5-transcribe");
    form.append("response_format", "verbose_json");

    const response = await fetch(`${GATEWAY}/audio/transcriptions`, {
      method: "POST",
      headers: { "Lovable-API-Key": apiKey(), "X-Lovable-AIG-SDK": "fetch" },
      body: form,
    });

    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`Transkription fehlgeschlagen [${response.status}]: ${detail.slice(0, 400)}`);
    }

    const payload = (await response.json()) as {
      text?: string;
      segments?: { start?: number; text?: string }[];
    };
    const lines = (payload.segments ?? [])
      .map((s) => ({ start: Number(s.start ?? 0), text: (s.text ?? "").trim() }))
      .filter((line) => line.text);
    return { text: payload.text ?? "", segments: lines.length ? chunkByTime(lines) : [] };
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
  .inputValidator((input: unknown) => z.object({ url: z.string().url() }).parse(input))
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

/** Plain page text for any other link. */
export const fetchPageText = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ url: z.string().url() }).parse(input))
  .handler(async ({ data }) => {
    const res = await fetch(data.url, { headers: { "user-agent": "Mozilla/5.0 CanvasSpark/1.0" } });
    if (!res.ok) throw new Error(`Seite konnte nicht geladen werden (${res.status})`);
    const html = await res.text();
    const title = decodeEntities(html.match(/<title>([\s\S]*?)<\/title>/)?.[1]?.trim() ?? data.url);
    const text = decodeEntities(
      html
        .replace(/<script[\s\S]*?<\/script>/g, " ")
        .replace(/<style[\s\S]*?<\/style>/g, " ")
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
  .inputValidator((input: unknown) =>
    z.object({ text: z.string().min(1), title: z.string().optional() }).parse(input),
  )
  .handler(async ({ data }) => {
    const prompt = `Analysiere den folgenden Inhalt und gib die enthaltenen strukturierten Daten zurück.
Erlaubt sind bis zu 6 Einträge. Regeln:
- kind "table" für tabellarische Daten (columns = Spaltenköpfe, rows = Zeilen).
- kind "list" für Aufzählungen (columns = ["Punkt"], jede Zeile ein Eintrag).
- kind "chart" für Zahlenreihen, die sich visualisieren lassen (columns = ["Kategorie","Wert"], Werte als Zahl-Text).
- chartType nur bei kind "chart" setzen (bar, line oder pie), sonst "none".
- Erfinde keine Daten. Wenn nichts Strukturierbares vorhanden ist, gib eine leere Liste zurück.

Titel: ${data.title ?? "Unbenannt"}

Inhalt:
${data.text.slice(0, 120_000)}`;

    const response = await fetch(`${GATEWAY}/responses`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "Lovable-API-Key": apiKey(),
        "X-Lovable-AIG-SDK": "fetch",
      },
      body: JSON.stringify({
        model: "openai/gpt-6-astra",
        input: prompt,
        stream: true,
        store: false,
        reasoning: { effort: "low" },
        text: {
          format: {
            type: "json_schema",
            name: "structures",
            strict: true,
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
          },
        },
      }),
    });

    if (!response.ok || !response.body) {
      const detail = await response.text();
      throw new Error(`Analyse fehlgeschlagen [${response.status}]: ${detail.slice(0, 300)}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let text = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;
        try {
          const event = JSON.parse(payload) as {
            type?: string;
            delta?: string;
            response?: { output_text?: string };
          };
          if (event.type === "response.output_text.delta" && event.delta) text += event.delta;
          if (event.type === "response.completed" && !text && event.response?.output_text) {
            text = event.response.output_text;
          }
        } catch {
          /* Teil-Event ignorieren */
        }
      }
    }

    try {
      return StructureSchema.parse(JSON.parse(text));
    } catch {
      throw new Error("Es konnten keine strukturierten Daten gelesen werden");
    }
  });
