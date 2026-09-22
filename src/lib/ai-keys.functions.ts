import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Json } from "@/integrations/supabase/types";
import { settingsFrom } from "@/lib/settings";
import {
  AI_PROVIDER_META,
  AI_PROVIDERS,
  isAiProvider,
  type AiProvider,
} from "@/lib/ai-providers";
import { decryptKey, encryptKey, testProviderKey } from "@/lib/ai-keys.server";

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
  return {
    keys,
    useByok: settings.useByok,
    byokProvider: settings.byokProvider,
    routing: settings.aiRouting,
    budgets: settings.aiBudgets,
  };
}

async function patchSettings(
  db: SupabaseClient,
  userId: string,
  patch: (current: ReturnType<typeof settingsFrom>) => ReturnType<typeof settingsFrom>,
) {
  const { data: profile } = await db
    .from("profiles")
    .select("settings")
    .eq("id", userId)
    .maybeSingle();
  const next = patch(settingsFrom((profile as { settings?: unknown } | null)?.settings));
  const { error } = await db
    .from("profiles")
    .update({ settings: next as unknown as Json, updated_at: new Date().toISOString() })
    .eq("id", userId);
  if (error) throw new Error("Einstellung konnte nicht gespeichert werden");
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

/** Anbieter und Modell je KI-Funktion festlegen. */
export const setAiRouting = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({
        fn: z.enum(AI_FUNCTIONS.map((entry) => entry.id) as [AiFunctionId, ...AiFunctionId[]]),
        provider: z.enum(["lovable", ...AI_PROVIDERS] as ["lovable", ...typeof AI_PROVIDERS]),
        model: z.string().max(120).nullable().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await patchSettings(context.supabase, context.userId, (current) => ({
      ...current,
      aiRouting: {
        ...current.aiRouting,
        [data.fn]: {
          provider: data.provider,
          model: data.model?.trim() ? data.model.trim() : null,
        },
      },
    }));
    await audit({
      actorId: context.userId,
      action: "ai.routing_changed",
      detail: `${data.fn}=${data.provider}${data.model ? `:${data.model}` : ""}`,
    });
    return listKeys(context.supabase, context.userId);
  });

/** Monatlicher Ausgabenhinweis je Anbieter (US-Dollar, 0 = kein Hinweis). */
export const setAiBudget = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({
        provider: z.enum(["lovable", ...AI_PROVIDERS] as ["lovable", ...typeof AI_PROVIDERS]),
        amount: z.number().min(0).max(100000),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await patchSettings(context.supabase, context.userId, (current) => {
      const budgets = { ...current.aiBudgets };
      if (data.amount > 0) budgets[data.provider] = data.amount;
      else delete budgets[data.provider];
      return { ...current, aiBudgets: budgets };
    });
    await audit({
      actorId: context.userId,
      action: "ai.budget_changed",
      detail: `${data.provider}=${data.amount}`,
    });
    return listKeys(context.supabase, context.userId);
  });

export type ProviderUsage = {
  provider: "lovable" | AiProvider;
  label: string;
  requests: number;
  failed: number;
  inputTokens: number;
  outputTokens: number;
  costMonth: number;
  costTotal: number;
  budget: number | null;
  overBudget: boolean;
};

/** Nutzung und geschätzte Kosten je Anbieter – laufender Monat und gesamt. */
export const getAiUsage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: profile } = await context.supabase
      .from("profiles")
      .select("settings")
      .eq("id", context.userId)
      .maybeSingle();
    const settings = settingsFrom((profile as { settings?: unknown } | null)?.settings);

    const { data: rows } = await context.supabase
      .from("ai_usage")
      .select("provider,fn,cost_usd,input_tokens,output_tokens,ok,created_at")
      .eq("user_id", context.userId)
      .order("created_at", { ascending: false })
      .limit(5000);

    const monthStart = new Date();
    monthStart.setUTCDate(1);
    monthStart.setUTCHours(0, 0, 0, 0);

    const byProvider = new Map<string, ProviderUsage>();
    const byFunction = new Map<string, { fn: string; requests: number; cost: number }>();

    for (const row of (rows ?? []) as {
      provider: string;
      fn: string;
      cost_usd: number | string;
      input_tokens: number;
      output_tokens: number;
      ok: boolean;
      created_at: string;
    }[]) {
      const provider = (row.provider === "lovable" || isAiProvider(row.provider)
        ? row.provider
        : "lovable") as "lovable" | AiProvider;
      const cost = Number(row.cost_usd ?? 0);
      const current =
        byProvider.get(provider) ??
        ({
          provider,
          label: provider === "lovable" ? "Lovable-KI-Zugang" : AI_PROVIDER_META[provider].label,
          requests: 0,
          failed: 0,
          inputTokens: 0,
          outputTokens: 0,
          costMonth: 0,
          costTotal: 0,
          budget: settings.aiBudgets[provider] ?? null,
          overBudget: false,
        } satisfies ProviderUsage);
      current.requests += 1;
      if (!row.ok) current.failed += 1;
      current.inputTokens += Number(row.input_tokens ?? 0);
      current.outputTokens += Number(row.output_tokens ?? 0);
      current.costTotal += cost;
      if (new Date(row.created_at).getTime() >= monthStart.getTime()) current.costMonth += cost;
      byProvider.set(provider, current);

      const fnEntry = byFunction.get(row.fn) ?? { fn: row.fn, requests: 0, cost: 0 };
      fnEntry.requests += 1;
      fnEntry.cost += cost;
      byFunction.set(row.fn, fnEntry);
    }

    // Anbieter ohne Nutzung trotzdem zeigen, damit ein Hinweis gesetzt werden kann.
    for (const provider of ["lovable", ...AI_PROVIDERS] as ("lovable" | AiProvider)[]) {
      if (byProvider.has(provider)) continue;
      byProvider.set(provider, {
        provider,
        label: provider === "lovable" ? "Lovable-KI-Zugang" : AI_PROVIDER_META[provider].label,
        requests: 0,
        failed: 0,
        inputTokens: 0,
        outputTokens: 0,
        costMonth: 0,
        costTotal: 0,
        budget: settings.aiBudgets[provider] ?? null,
        overBudget: false,
      });
    }

    const providers = [...byProvider.values()].map((entry) => ({
      ...entry,
      costMonth: Math.round(entry.costMonth * 1e6) / 1e6,
      costTotal: Math.round(entry.costTotal * 1e6) / 1e6,
      overBudget: entry.budget !== null && entry.costMonth >= entry.budget,
    }));

    return {
      providers,
      functions: [...byFunction.values()].sort((a, b) => b.requests - a.requests),
      since: monthStart.toISOString(),
    };
  });

/**
 * Widerruf: Schlüssel löschen, Routen dieses Anbieters auf den Lovable-Zugang
 * zurücksetzen und – falls es der aktive Anbieter war – BYOK abschalten.
 */
export const revokeAiKey = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z.object({ provider: z.enum(AI_PROVIDERS), confirm: z.literal(true) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("user_ai_keys")
      .delete()
      .eq("user_id", context.userId)
      .eq("provider", data.provider);
    if (error) throw new Error("Schlüssel konnte nicht widerrufen werden");

    await patchSettings(context.supabase, context.userId, (current) => {
      const routing = { ...current.aiRouting };
      for (const fn of AI_FUNCTIONS) {
        if (routing[fn.id]?.provider === data.provider) {
          routing[fn.id] = { provider: "lovable", model: null };
        }
      }
      return {
        ...current,
        aiRouting: routing,
        useByok: current.byokProvider === data.provider ? false : current.useByok,
      };
    });

    await audit({
      actorId: context.userId,
      action: "ai_key.revoked",
      detail: `${data.provider} – Schlüssel gelöscht, Funktionen auf Lovable-Zugang zurückgesetzt`,
    });
    return listKeys(context.supabase, context.userId);
  });
