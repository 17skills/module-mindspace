import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { settingsFrom } from "@/lib/settings";
import {
  AI_PROVIDER_META,
  AI_PROVIDERS,
  isAiProvider,
  type AiProvider,
} from "@/lib/ai-providers";
import { decryptKey, encryptKey, testProviderKey } from "@/lib/ai-keys.server";

type Json = Record<string, unknown>;

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

/** Datensparsames Protokoll – gleiche Routine wie im Konto-Bereich. */
async function audit(entry: { actorId: string; action: string; detail?: string }) {
  const db = await admin();
  await db.from("audit_log").insert({
    actor_id: entry.actorId,
    subject_user_id: entry.actorId,
    action: entry.action,
    detail: entry.detail ?? null,
  });
}

export type AiKeyInfo = {
  provider: AiProvider;
  label: string;
  last4: string;
  baseUrl: string | null;
  modelHint: string | null;
  updatedAt: string;
};

async function listKeys(db: SupabaseClient, userId: string) {
  const [keysResult, profileResult] = await Promise.all([
    db
      .from("user_ai_keys")
      .select("provider,base_url,model_hint,last4,updated_at")
      .eq("user_id", userId),
    db.from("profiles").select("settings").eq("id", userId),
  ]);
  const rows = (keysResult.data ?? []) as {
    provider: unknown;
    last4: string | null;
    base_url: string | null;
    model_hint: string | null;
    updated_at: string | null;
  }[];
  const profileRows = (profileResult.data as { settings: unknown }[] | null) ?? [];
  const settings = settingsFrom(profileRows[0]?.settings);
  const keys: AiKeyInfo[] = rows
    .filter((row) => isAiProvider(row.provider))
    .map((row) => ({
      provider: row.provider as AiProvider,
      label: AI_PROVIDER_META[row.provider as AiProvider].label,
      last4: String(row.last4 ?? ""),
      baseUrl: row.base_url,
      modelHint: row.model_hint,
      updatedAt: String(row.updated_at ?? ""),
    }));
  return { keys, useByok: settings.useByok, byokProvider: settings.byokProvider };
}

/** Liste der eigenen Schlüssel (nur maskiert) plus BYOK-Schalter. */
export const listAiKeys = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => listKeys(context.supabase, context.userId));

/** Speichert oder ersetzt einen Anbieter-Schlüssel; der Klartext bleibt auf dem Server. */
export const saveAiKey = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({
        provider: z.enum(AI_PROVIDERS),
        key: z.string().min(8).max(500),
        baseUrl: z
          .string()
          .url()
          .startsWith("https://")
          .max(300)
          .optional()
          .or(z.literal("").transform(() => undefined)),
        modelHint: z.string().max(120).optional().or(z.literal("").transform(() => undefined)),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const encrypted = encryptKey(data.key.trim());
    const base =
      data.provider === "openrouter"
        ? (data.baseUrl ?? AI_PROVIDER_META.openrouter.baseUrl)
        : null;
    const { error } = await context.supabase.from("user_ai_keys").upsert(
      {
        user_id: context.userId,
        provider: data.provider,
        encrypted_key: encrypted,
        base_url: base,
        model_hint: data.modelHint?.trim() || null,
        last4: data.key.trim().slice(-4),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,provider" },
    );
    if (error) throw new Error("Schlüssel konnte nicht gespeichert werden");
    await audit({ actorId: context.userId, action: "ai_key.saved", detail: data.provider });
    return listKeys(context.supabase, context.userId);
  });

/** Entfernt einen gespeicherten Schlüssel. */
export const deleteAiKey = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ provider: z.enum(AI_PROVIDERS) }).parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("user_ai_keys")
      .delete()
      .eq("user_id", context.userId)
      .eq("provider", data.provider);
    if (error) throw new Error("Schlüssel konnte nicht entfernt werden");
    await audit({ actorId: context.userId, action: "ai_key.deleted", detail: data.provider });
    return listKeys(context.supabase, context.userId);
  });

/** BYOK-Schalter und gewählter Anbieter – gespeichert in den persönlichen Einstellungen. */
export const setUseByok = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({
        enabled: z.boolean(),
        provider: z.enum(AI_PROVIDERS).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: profile } = await context.supabase
      .from("profiles")
      .select("settings")
      .eq("id", context.userId)
      .maybeSingle();
    const settings = settingsFrom(profile?.settings);
    const next = { ...settings, useByok: data.enabled };
    if (data.provider) next.byokProvider = data.provider;
    const { error } = await context.supabase
      .from("profiles")
      .update({ settings: next as unknown as Json, updated_at: new Date().toISOString() })
      .eq("id", context.userId);
    if (error) throw new Error("Einstellung konnte nicht gespeichert werden");
    await audit({
      actorId: context.userId,
      action: "ai.byok_toggled",
      detail: `enabled=${data.enabled}${data.provider ? `,provider=${data.provider}` : ""}`,
    });
    return listKeys(context.supabase, context.userId);
  });

/** Echte Mini-Anfrage gegen den gespeicherten Schlüssel – prüft ohne Klartext-Ausgabe. */
export const testAiKey = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ provider: z.enum(AI_PROVIDERS) }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: row } = await context.supabase
      .from("user_ai_keys")
      .select("encrypted_key,base_url,model_hint")
      .eq("user_id", context.userId)
      .eq("provider", data.provider)
      .maybeSingle();
    if (!row) return { ok: false, message: "Für diesen Anbieter ist kein Schlüssel hinterlegt." };
    try {
      const entry = {
        key: decryptKey(row.encrypted_key),
        baseUrl: row.base_url,
        modelHint: row.model_hint,
      };
      return await testProviderKey(data.provider, entry);
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : "Verbindung fehlgeschlagen",
      };
    }
  });
