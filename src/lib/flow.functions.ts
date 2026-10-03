import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

/**
 * Führt den verkabelten Ablauf einer App aus: Kamera-Quelle → API-Schritte → Ergebnis.
 * Welche Schritte laufen, bestimmt allein die Verkabelung im Scope. Gäste dürfen das
 * nur bei öffentlich freigegebenen Apps; das Foto selbst verlässt das Gerät nicht.
 */
export const runCameraFlow = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z
      .object({
        appId: z.string().uuid(),
        cameraId: z.string().uuid(),
        lat: z.number().min(-90).max(90),
        lon: z.number().min(-180).max(180),
        source: z.enum(["exif", "geraet", "manuell"]).default("manuell"),
        // verkleinertes JPEG als data-URL, höchstens ~1,5 MB
        photo: z
          .string()
          .max(2_000_000)
          .regex(/^data:image\/(jpeg|png|webp);base64,/)
          .optional(),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { optionalRequestUserId, appRoleOf } = await import("@/lib/app-permissions.server");
    const { getRequest } = await import("@tanstack/react-start/server");
    const { assertRate, callerKey } = await import("@/lib/rate-limit.server");
    const userId = await optionalRequestUserId();
    const role = await appRoleOf(userId, data.appId);
    if (!role) throw new Error("Diese App ist nur für freigegebene Personen verfügbar.");
    const request = getRequest();
    const caller = userId ?? (request ? await callerKey(request) : "unknown");
    assertRate(`flow:${caller}`, userId ? 20 : 10, 60_000);

    const { loadPublicApp } = await import("@/lib/app-data.server");
    const { db, app, ids } = await loadPublicApp(data.appId);
    if (!ids.includes(data.cameraId)) throw new Error("Diese Quelle gehört nicht zur App.");
    const boardId = String(app.board_id);

    const { data: camera } = await db
      .from("nodes")
      .select("id,type")
      .eq("id", data.cameraId)
      .maybeSingle();
    if (!camera || camera.type !== "camera") throw new Error("Kamera-Quelle nicht gefunden.");

    // Foto ablegen: eine Zeile je Aufnahme, so kollidieren viele Erfasser nie.
    let captureId: string | null = null;
    let photoPath: string | null = null;
    if (data.photo) {
      const match = /^data:(image\/[a-z]+);base64,(.+)$/i.exec(data.photo);
      if (match) {
        captureId = crypto.randomUUID();
        const binary = atob(match[2]!);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        const path = `${boardId}/captures/${captureId}.jpg`;
        const { error: upErr } = await db.storage
          .from("field-photos")
          .upload(path, bytes, { contentType: match[1]!, upsert: false });
        if (upErr) throw new Error("Foto konnte nicht gespeichert werden – bitte erneut senden.");
        photoPath = path;
        const { error: insErr } = await db.from("captures").insert({
          id: captureId,
          board_id: boardId,
          app_id: data.appId,
          node_id: data.cameraId,
          photo_path: path,
          lat: data.lat,
          lon: data.lon,
          source: data.source,
          created_by: userId,
        });
        if (insErr) throw new Error("Aufnahme konnte nicht protokolliert werden.");
      }
    }

    const { runFlow } = await import("@/lib/flow-run.server");
    const result = await runFlow({
      db: db as never,
      boardId,
      appId: data.appId,
      startNodeId: data.cameraId,
      userId,
      values: { lat: data.lat, lon: data.lon, source: data.source, ...(photoPath ? { photoPath } : {}) },
      origin: "app",
      actorLabel: userId ? "App" : "App (Gast)",
    });

    return {
      input: { lat: data.lat, lon: data.lon, source: data.source },
      captureId,
      steps: result.steps,
      outputs: result.outputs,
    };
  });
