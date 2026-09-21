import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/** One library entry behind a view link. No auth required. */
export const getPublicLibraryEntry = createServerFn({ method: "POST" })
  .validator((input: unknown) => z.object({ token: z.string().uuid() }).parse(input))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: entry, error } = await supabaseAdmin
      .from("module_library")
      .select("id,title,description,tags,scope,payload,is_public,created_at")
      .eq("share_token", data.token)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!entry || !entry.is_public) throw new Error("Dieser Link ist nicht (mehr) freigegeben");
    return entry;
  });

/** Copy an entry reachable by link into my own library. */
export const copySharedEntry = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z.object({ token: z.string().uuid().nullable(), id: z.string().uuid().nullable() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const query = supabaseAdmin
      .from("module_library")
      .select("id,user_id,title,description,tags,scope,payload,is_public");
    const { data: entry, error } = await (data.token
      ? query.eq("share_token", data.token)
      : query.eq("id", data.id ?? "")
    ).maybeSingle();
    if (error) throw new Error(error.message);
    if (!entry) throw new Error("Eintrag nicht gefunden");

    if (!entry.is_public && entry.user_id !== context.userId) {
      const { data: share } = await supabaseAdmin
        .from("module_library_shares")
        .select("id")
        .eq("library_id", entry.id)
        .eq("user_id", context.userId)
        .maybeSingle();
      if (!share) throw new Error("Kein Zugriff auf diesen Eintrag");
    }

    const { data: copy, error: insertError } = await supabaseAdmin
      .from("module_library")
      .insert({
        user_id: context.userId,
        title: `${entry.title} (Kopie)`,
        description: entry.description,
        tags: entry.tags,
        scope: entry.scope,
        payload: entry.payload,
      })
      .select("id")
      .single();
    if (insertError) throw new Error(insertError.message);
    return { id: copy.id as string };
  });

/** Share an entry with one existing account. Owner only. */
export const shareLibraryEntry = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z.object({ id: z.string().uuid(), email: z.string().email() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: entry } = await supabaseAdmin
      .from("module_library")
      .select("id,user_id")
      .eq("id", data.id)
      .maybeSingle();
    if (!entry || entry.user_id !== context.userId) throw new Error("Nur Eigentümer dürfen teilen");

    const email = data.email.trim().toLowerCase();
    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("id")
      .ilike("email", email)
      .maybeSingle();
    if (!profile) throw new Error("Für diese E-Mail gibt es noch kein Konto");
    if (profile.id === context.userId) throw new Error("Dir gehört dieser Eintrag bereits");

    const { error } = await supabaseAdmin
      .from("module_library_shares")
      .upsert({ library_id: data.id, user_id: profile.id, email }, { onConflict: "library_id,user_id" });
    if (error) throw new Error(error.message);
    return { email };
  });

/** People an entry is shared with. Owner only. */
export const listEntryShares = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: entry } = await supabaseAdmin
      .from("module_library")
      .select("id,user_id")
      .eq("id", data.id)
      .maybeSingle();
    if (!entry || entry.user_id !== context.userId) throw new Error("Nur Eigentümer dürfen teilen");
    const { data: rows, error } = await supabaseAdmin
      .from("module_library_shares")
      .select("id,email,user_id")
      .eq("library_id", data.id)
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    return (rows ?? []).map((row) => ({
      id: row.id as string,
      email: (row.email as string | null) ?? "Unbekannt",
    }));
  });

/** Withdraw one share. Owner only. */
export const removeEntryShare = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z.object({ id: z.string().uuid(), shareId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: entry } = await supabaseAdmin
      .from("module_library")
      .select("id,user_id")
      .eq("id", data.id)
      .maybeSingle();
    if (!entry || entry.user_id !== context.userId) throw new Error("Nur Eigentümer dürfen teilen");
    const { error } = await supabaseAdmin
      .from("module_library_shares")
      .delete()
      .eq("id", data.shareId)
      .eq("library_id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Entries other people shared with me. */
export const listSharedEntries = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: shares, error } = await supabaseAdmin
      .from("module_library_shares")
      .select("library_id")
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    const ids = (shares ?? []).map((row) => row.library_id as string);
    if (!ids.length) return [];
    const { data: rows, error: entryError } = await supabaseAdmin
      .from("module_library")
      .select("id,user_id,title,description,tags,scope,payload,share_token,is_public,created_at,updated_at")
      .in("id", ids)
      .order("updated_at", { ascending: false });
    if (entryError) throw new Error(entryError.message);
    const owners = [...new Set((rows ?? []).map((row) => row.user_id as string))];
    const emails = new Map<string, string>();
    if (owners.length) {
      const { data: profiles } = await supabaseAdmin
        .from("profiles")
        .select("id,email")
        .in("id", owners);
      for (const profile of profiles ?? []) emails.set(profile.id, profile.email ?? "");
    }
    return (rows ?? []).map((row) => ({
      ...row,
      owner_email: emails.get(row.user_id as string) ?? "",
    }));
  });
