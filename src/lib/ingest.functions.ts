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
    let transcriptError: string | null = null;
    try {
      transcript = await youtubeTranscript(videoId);
    } catch (error) {
      transcriptError = error instanceof Error ? error.message : "Transkript nicht verfügbar";
    }

    return {
      videoId,
      title,
      author,
      thumbnail: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
      transcript,
      transcriptError,
    };
  });

async function youtubeTranscript(videoId: string): Promise<string> {
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
  const lines = [...xml.matchAll(/<text[^>]*>([\s\S]*?)<\/text>/g)].map((m) =>
    decodeEntities(m[1] ?? "").replace(/\s+/g, " ").trim(),
  );
  const text = lines.filter(Boolean).join(" ");
  if (!text) throw new Error("Untertitel sind leer");
  return text;
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
    form.append("response_format", "json");

    const response = await fetch(`${GATEWAY}/audio/transcriptions`, {
      method: "POST",
      headers: { "Lovable-API-Key": apiKey(), "X-Lovable-AIG-SDK": "fetch" },
      body: form,
    });

    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`Transkription fehlgeschlagen [${response.status}]: ${detail.slice(0, 400)}`);
    }

    const payload = (await response.json()) as { text?: string };
    return { text: payload.text ?? "" };
  });

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
      return { title: data.url.split("/").pop() ?? "Audio", audioUrl: data.url };
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
      return { title, audioUrl: decodeEntities(audioUrl) };
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
    return { title, audioUrl: decodeEntities(audioUrl) };
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
    return { title, text };
  });
