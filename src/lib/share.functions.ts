import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/** Board plus all modules for a read-only guest link. No auth required. */
export const getSharedBoard = createServerFn({ method: "POST" })
  .validator((input: unknown) => z.object({ token: z.string().uuid() }).parse(input))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: board, error } = await supabaseAdmin
      .from("boards")
      .select("id,title,description,is_public")
      .eq("share_token", data.token)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!board || !board.is_public) throw new Error("Dieser Link ist nicht (mehr) freigegeben");

    const [nodeRes, edgeRes] = await Promise.all([
      supabaseAdmin.from("nodes").select("*").eq("board_id", board.id),
      supabaseAdmin.from("edges").select("*").eq("board_id", board.id),
    ]);
    if (nodeRes.error) throw new Error(nodeRes.error.message);
    if (edgeRes.error) throw new Error(edgeRes.error.message);

    return {
      board: { id: board.id, title: board.title, description: board.description },
      nodes: nodeRes.data ?? [],
      edges: edgeRes.data ?? [],
    };
  });

async function assertOwner(
  supabase: { from: (t: string) => any },
  boardId: string,
  userId: string,
) {
  const { data, error } = await supabase
    .from("boards")
    .select("id,user_id")
    .eq("id", boardId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data || data.user_id !== userId) throw new Error("Nur Eigentümer dürfen Mitglieder verwalten");
}

/** Members of a board, with their e-mail address. Owner only. */
export const listMembers = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ boardId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await assertOwner(context.supabase as never, data.boardId, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows, error } = await supabaseAdmin
      .from("board_members")
      .select("id,user_id,role,created_at")
      .eq("board_id", data.boardId)
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    const ids = (rows ?? []).map((row) => row.user_id);
    const emails = new Map<string, string>();
    if (ids.length) {
      const { data: profiles } = await supabaseAdmin
        .from("profiles")
        .select("id,email,display_name")
        .in("id", ids);
      for (const profile of profiles ?? []) emails.set(profile.id, profile.email ?? "");
    }
    return (rows ?? []).map((row) => ({
      id: row.id,
      userId: row.user_id,
      role: row.role,
      email: emails.get(row.user_id) ?? "Unbekannt",
    }));
  });

/** Invite an existing account to collaborate on this board only. Owner only. */
export const addMember = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z.object({ boardId: z.string().uuid(), email: z.string().email() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertOwner(context.supabase as never, data.boardId, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const email = data.email.trim().toLowerCase();
    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("id")
      .ilike("email", email)
      .maybeSingle();
    if (!profile) throw new Error("Für diese E-Mail gibt es noch kein Konto");
    if (profile.id === context.userId) throw new Error("Du bist bereits Eigentümer dieses Boards");
    const { error } = await supabaseAdmin
      .from("board_members")
      .upsert(
        { board_id: data.boardId, user_id: profile.id, role: "member" },
        { onConflict: "board_id,user_id" },
      );
    if (error) throw new Error(error.message);
    return { email };
  });

/** Remove a member. Owner only. */
export const removeMember = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z.object({ boardId: z.string().uuid(), memberId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertOwner(context.supabase as never, data.boardId, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("board_members")
      .delete()
      .eq("id", data.memberId)
      .eq("board_id", data.boardId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
