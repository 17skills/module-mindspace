import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { brandingFrom } from "@/lib/apps";
import {
  changeFinding,
  insertFinding,
  loadAppNodes,
  loadPublicApp,
  type FindingWrite,
} from "@/lib/app-data.server";

type Json = Record<string, unknown>;

/** Öffentliche Bühne: App-Einstellungen plus die zugehörigen Module. */
export const getPublicApp = createServerFn({ method: "POST" })
  .validator((input: unknown) => z.object({ appId: z.string().uuid() }).parse(input))
  .handler(async ({ data }) => {
    const { app, nodes, boardTitle } = await loadAppNodes(data.appId);
    return {
      app: {
        id: app.id,
        boardId: app.board_id,
        title: app.title,
        kind: app.kind,
        branding: brandingFrom(app.branding),
      },
      boardTitle,
      nodesJson: JSON.stringify(nodes),
    };
  });

/** Bewertet ein vor Ort aufgenommenes Foto für eine freigegebene App. */
export const appAssessPhoto = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z
      .object({
        appId: z.string().uuid(),
        image: z.string().min(32),
        label: z.string().default(""),
        report: z.string().default(""),
        rates: z.string().default(""),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { app } = await loadPublicApp(data.appId);
    const { assessPhoto } = await import("@/lib/inspection-vision.server");
    const { loadAiKeyConfigForOwner } = await import("@/lib/ai-keys.server");
    // BYOK des App-Inhabers: die App läuft ohne Login, zahlt aber beim Inhaber.
    const cfg = app.user_id ? await loadAiKeyConfigForOwner(app.user_id) : null;
    return assessPhoto(
      {
        image: data.image,
        label: data.label,
        report: data.report,
        rates: data.rates,
      },
      cfg ?? { useByok: false, provider: "openai", keys: {} },
    );
  });

const FindingInput = z.object({
  label: z.string().default(""),
  lat: z.number().nullable().default(null),
  lon: z.number().nullable().default(null),
  category: z.string().default("Sonstiges"),
  finding: z.string().default(""),
  priority: z.number().default(5),
  action: z.string().default(""),
  cost: z.number().default(0),
  confidence: z.number().default(0),
  reason: z.string().default(""),
  thumb: z.string().nullable().default(null),
  source: z.enum(["exif", "manuell", "unbekannt"]).default("unbekannt"),
});

/** Neuen Befund aus der mobilen Erfassung in das Inspektionsmodul schreiben. */
export const appAddFinding = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z.object({ appId: z.string().uuid(), finding: FindingInput }).parse(input),
  )
  .handler(async ({ data }) => {
    const write: FindingWrite = {
      ...data.finding,
      lat: data.finding.lat,
      lon: data.finding.lon,
      thumb: data.finding.thumb,
    };
    return insertFinding(data.appId, write);
  });

/** Status einer Maßnahme aus dem Cockpit heraus ändern. */
export const appSetFindingStatus = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z
      .object({
        appId: z.string().uuid(),
        nodeId: z.string().uuid(),
        findingId: z.string().min(1),
        status: z.enum(["offen", "beauftragt", "in arbeit", "erledigt"]),
      })
      .parse(input),
  )
  .handler(async ({ data }) => changeFinding(data.appId, data.findingId, { status: data.status }));
