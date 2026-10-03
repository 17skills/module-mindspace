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

async function auditDataChange(actorId: string | null, appId: string, action: string, detail?: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  await supabaseAdmin.from("audit_log").insert({
    actor_id: actorId,
    subject_user_id: actorId,
    action,
    object_type: "app",
    object_id: appId,
    detail: detail ?? (actorId ? null : "Gast"),
  });
}

/**
 * Erfassen in öffentlichen Erfassungs-Apps: Techniker brauchen kein Konto.
 * Alle anderen Apps verlangen weiterhin „Daten aktualisieren“. Gäste sind gedrosselt.
 */
async function assertCaptureAccess(appId: string, bucket: string): Promise<string | null> {
  const userId = await optionalRequestUserId();
  const role = await appRoleOf(userId, appId);
  if (role === "data_editor" || role === "config_admin") return userId;
  if (!role) throw new Error("Kein Zugriff auf diese App.");
  const { app } = await loadPublicApp(appId);
  if (app.kind !== "capture") {
    throw new Error("Für diese Änderung brauchst du das Recht ‚Daten aktualisieren‘.");
  }
  const { getRequest } = await import("@tanstack/react-start/server");
  const { assertRate, callerKey } = await import("@/lib/rate-limit.server");
  const request = getRequest();
  const caller = userId ?? (request ? await callerKey(request) : "unknown");
  assertRate(`${bucket}:${caller}`, 12, 60_000);
  return userId;
}

/** Entscheidungsknopf aus den Kacheln: nur protokollieren, keine Wirkung. */
export const appRecordSignal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({
        appId: z.string().uuid(),
        nodeId: z.string().uuid(),
        choice: z.enum(["Maßnahmen freigeben", "Zweitprüfung anfordern"]),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAppRole(context.userId, data.appId, "data_editor");
    await auditDataChange(context.userId, data.appId, "app.signal", `${data.nodeId}:${data.choice}`);
    return { ok: true };
  });

/** Öffentliche Bühne: App-Einstellungen plus die zugehörigen Module. */
export const getPublicApp = createServerFn({ method: "POST" })
  .validator((input: unknown) => z.object({ appId: z.string().uuid() }).parse(input))
  .handler(async ({ data }) => {
    const userId = await optionalRequestUserId();
    const role = await appRoleOf(userId, data.appId);
    if (!role) throw new Error("Diese App ist nur für freigegebene Personen verfügbar.");
    const { app, nodes, boardTitle, boardRules } = await loadAppNodes(data.appId);
    const { readGovernance, transparencyNote } = await import("@/lib/governance");
    const { mergeBranding, readOrgBranding } = await import("@/lib/zones");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // Standard der Organisation laden – Apps ohne eigenes Branding erben ihn.
    const { data: appRow } = await supabaseAdmin
      .from("apps")
      .select("org_id")
      .eq("id", data.appId)
      .maybeSingle();
    let orgBranding = null as ReturnType<typeof readOrgBranding> | null;
    if (appRow?.org_id) {
      const { data: org } = await supabaseAdmin
        .from("organizations")
        .select("branding")
        .eq("id", appRow.org_id)
        .maybeSingle();
      orgBranding = readOrgBranding(org?.branding);
    } else {
      orgBranding = readOrgBranding(null);
    }
    return {
      app: {
        id: app.id,
        boardId: app.board_id,
        title: app.title,
        kind: app.kind,
        branding: mergeBranding(brandingFrom(app.branding), orgBranding),
      },
      boardTitle,
      aiNotice: transparencyNote(readGovernance(boardRules)),
      nodesJson: JSON.stringify(nodes),
      role,
    };

  });

/** Bewertet ein vor Ort aufgenommenes Foto für eine freigegebene App. */
export const appAssessPhoto = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z
      .object({
        appId: z.string().uuid(),
        image: z.string().min(32).max(3_000_000),
        label: z.string().max(500).default(""),
        report: z.string().max(4000).default(""),
        rates: z.string().max(4000).default(""),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    await assertCaptureAccess(data.appId, "assess");
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
  .validator((input: unknown) =>
    z.object({ appId: z.string().uuid(), finding: FindingInput }).parse(input),
  )
  .handler(async ({ data }) => {
    const userId = await assertCaptureAccess(data.appId, "finding");
    const write: FindingWrite = {
      ...data.finding,
      lat: data.finding.lat,
      lon: data.finding.lon,
      thumb: data.finding.thumb,
      photo: data.finding.photo,
    };
    const result = await insertFinding(data.appId, write);
    await auditDataChange(userId, data.appId, "app.data.finding_added", result.id);
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

