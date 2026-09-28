import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertBoardRole } from "@/lib/guard.server";

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

async function hashKey(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(`scopebuilder-api:${value}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Neuer Zugriffsschlüssel für einen Scope. Der Klartext wird genau einmal angezeigt. */
export const createApiKey = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z.object({ boardId: z.string().uuid(), name: z.string().max(80).default("") }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertBoardRole(context.userId, data.boardId, "owner");
    const raw = Array.from(crypto.getRandomValues(new Uint8Array(24)), (b) =>
      b.toString(16).padStart(2, "0"),
    ).join("");
    const secret = `sbk_${raw}`;
    const db = await admin();
    const { data: row, error } = await db
      .from("api_keys")
      .insert({
        board_id: data.boardId,
        name: data.name || "Schlüssel",
        key_hash: await hashKey(secret),
        prefix: secret.slice(0, 12),
        created_by: context.userId,
      })
      .select("id,name,prefix,created_at")
      .single();
    if (error) throw new Error("Schlüssel konnte nicht angelegt werden.");
    return { ...row, secret };
  });

export const listApiKeys = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ boardId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await assertBoardRole(context.userId, data.boardId, "editor");
    const db = await admin();
    const { data: rows } = await db
      .from("api_keys")
      .select("id,name,prefix,created_at,last_used_at,revoked_at")
      .eq("board_id", data.boardId)
      .order("created_at", { ascending: false })
      .limit(50);
    return rows ?? [];
  });

export const revokeApiKey = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z.object({ boardId: z.string().uuid(), keyId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertBoardRole(context.userId, data.boardId, "owner");
    const db = await admin();
    await db
      .from("api_keys")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", data.keyId)
      .eq("board_id", data.boardId);
    return { ok: true };
  });
