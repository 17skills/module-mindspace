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
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { appRoleOf, assertAppRole, optionalRequestUserId } from "@/lib/app-permissions.server";

type Json = Record<string, unknown>;

async function auditDataChange(actorId: string, appId: string, action: string, detail?: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  await supabaseAdmin.from("audit_log").insert({
    actor_id: actorId,
    subject_user_id: actorId,
    action,
    object_type: "app",
    object_id: appId,
    detail: detail ?? null,
  });
}

/** Öffentliche Bühne: App-Einstellungen plus die zugehörigen Module. */
export const getPublicApp = createServerFn({ method: "POST" })
  .validator((input: unknown) => z.object({ appId: z.string().uuid() }).parse(input))
  .handler(async ({ data }) => {
    const userId = await optionalRequestUserId();
    const role = await appRoleOf(userId, data.appId);
    if (!role) throw new Error("Diese App ist nur für freigegebene Personen verfügbar.");
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
      role,
    };
  });

/** Bewertet ein vor Ort aufgenommenes Foto für eine freigegebene App. */
export const appAssessPhoto = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
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
  .handler(async ({ data, context }) => {
    await assertAppRole(context.userId, data.appId, "data_editor");
    const { app } = await loadPublicApp(data.appId);
    const { assessPhoto } = await import("@/lib/inspection-vision.server");
    const { loadAiKeyConfigForOwner } = await import("@/lib/ai-keys.server");
    // BYOK des App-Inhabers: die App läuft ohne Login, die KI-Kosten aber beim Inhaber.
    const cfg = await loadAiKeyConfigForOwner(app.user_id);
    return assessPhoto(
      {
        image: data.image,
        label: data.label,
        report: data.report,
        rates: data.rates,
      },
      cfg,
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
  photo: z.string().nullable().default(null),
  source: z.enum(["exif", "manuell", "unbekannt"]).default("unbekannt"),
});

/** Neuen Befund aus der mobilen Erfassung in das Inspektionsmodul schreiben. */
export const appAddFinding = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z.object({ appId: z.string().uuid(), finding: FindingInput }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAppRole(context.userId, data.appId, "data_editor");
    const write: FindingWrite = {
      ...data.finding,
      lat: data.finding.lat,
      lon: data.finding.lon,
      thumb: data.finding.thumb,
      photo: data.finding.photo,
    };
    const result = await insertFinding(data.appId, write);
    await auditDataChange(context.userId, data.appId, "app.data.finding_added", result.id);
    return result;
  });

/** Status einer Maßnahme aus dem Cockpit heraus ändern. */
export const appSetFindingStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
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
  .handler(async ({ data, context }) => {
    await assertAppRole(context.userId, data.appId, "data_editor");
    const result = await changeFinding(data.appId, data.findingId, { status: data.status }, data.nodeId);
    await auditDataChange(context.userId, data.appId, "app.data.finding_status_changed", `${data.findingId}:${data.status}`);
    return result;
  });

/** Restaurants rund um den Fotostandort (OpenStreetMap, nur lesend, gedrosselt). */
export const appNearbyRestaurants = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({
        appId: z.string().uuid(),
        lat: z.number().min(-90).max(90),
        lon: z.number().min(-180).max(180),
        radius: z.number().int().min(100).max(3000).default(1000),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const role = await appRoleOf(context.userId, data.appId);
    if (!role) throw new Error("Kein Zugriff auf diese App.");
    const { assertRate } = await import("@/lib/rate-limit.server");
    assertRate(`nearby:${context.userId}`, 20, 60_000);
    const { parsePlaces } = await import("@/lib/nearby");
    const query = `[out:json][timeout:15];(node["amenity"="restaurant"](around:${data.radius},${data.lat},${data.lon});way["amenity"="restaurant"](around:${data.radius},${data.lat},${data.lon}););out center 60;`;
    try {
      const response = await fetch("https://overpass-api.de/api/interpreter", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "scopebuilder/1.0" },
        body: `data=${encodeURIComponent(query)}`,
        signal: AbortSignal.timeout(20_000),
      });
      if (!response.ok) {
        console.error("overpass", response.status);
        return { places: [], error: "Kartendienst gerade nicht erreichbar" };
      }
      return { places: parsePlaces(await response.json(), data), error: null as string | null };
    } catch (err) {
      console.error("overpass", err);
      return { places: [], error: "Kartendienst gerade nicht erreichbar" };
    }
  });
