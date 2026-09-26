import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { RETENTION_CHOICES, expiresAt as expiry } from "@/lib/runs";

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

async function logEvent(entry: {
  runId: string;
  boardId: string;
  actorId: string | null;
  action: string;
  detail?: string;
}) {
  const db = await admin();
  await db.from("run_events").insert({
    run_id: entry.runId,
    board_id: entry.boardId,
    actor_id: entry.actorId,
    action: entry.action,
    detail: entry.detail ?? null,
  });
}

/** Ausgang laden und Recht des Aufrufers daran prüfen. */
async function outputFor(userId: string, outputNodeId: string, min: "viewer" | "editor") {
  const { assertNodeRole, nodeRoleOf } = await import("@/lib/guard.server");
  await assertNodeRole(userId, outputNodeId, min);
  const role = await nodeRoleOf(userId, outputNodeId);
  const db = await admin();
  const { data: node, error } = await db
    .from("nodes")
    .select("id,board_id,type,metadata")
    .eq("id", outputNodeId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!node || node.type !== "output") throw new Error("Das ist kein Ergebnis-Modul");
  return { node, role };
}

const listInput = z.object({
  outputNodeId: z.string().uuid(),
  status: z.enum(["running", "done", "failed"]).optional(),
  days: z.number().int().min(1).max(365).optional(),
  page: z.number().int().min(0).max(1000).default(0),
});

const PAGE = 50;

/** Zählwert und letzter Zeitpunkt – für die Zeile am Modul, ohne Liste. */
export const runStats = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ outputNodeId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { seesAllRuns } = await import("@/lib/runs");
    const { role } = await outputFor(context.userId, data.outputNodeId, "viewer");
    const db = await admin();
    let query = db
      .from("runs")
      .select("created_at", { count: "exact" })
      .eq("output_node_id", data.outputNodeId)
      .order("created_at", { ascending: false })
      .limit(1);
    if (!seesAllRuns(role)) query = query.eq("user_id", context.userId);
    const { data: rows, count, error } = await query;
    if (error) throw new Error(error.message);
    return { count: count ?? 0, lastAt: rows?.[0]?.created_at ?? null, seesAll: seesAllRuns(role) };
  });

/** Liste der Durchläufe, seitenweise. Bearbeiter sehen alle, andere nur eigene. */
export const listRuns = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => listInput.parse(input))
  .handler(async ({ data, context }) => {
    const { seesAllRuns } = await import("@/lib/runs");
    const { role } = await outputFor(context.userId, data.outputNodeId, "viewer");
    const db = await admin();
    let query = db
      .from("runs")
      .select(
        "id,user_id,status,input_path,input_mime,input_sha256,engine,provider,model,result,error,created_at,finished_at,expires_at,purged_at",
      )
      .eq("output_node_id", data.outputNodeId)
      .order("created_at", { ascending: false })
      .range(data.page * PAGE, data.page * PAGE + PAGE - 1);
    if (!seesAllRuns(role)) query = query.eq("user_id", context.userId);
    if (data.status) query = query.eq("status", data.status);
    if (data.days) query = query.gte("created_at", new Date(Date.now() - data.days * 86_400_000).toISOString());
    const { data: rows, error } = await query;
    if (error) throw new Error(error.message);

    const ids = [...new Set((rows ?? []).map((r) => r.user_id).filter(Boolean) as string[])];
    const names = new Map<string, string>();
    if (ids.length) {
      const { data: profiles } = await db.from("profiles").select("id,email,display_name").in("id", ids);
      for (const p of profiles ?? []) names.set(p.id, p.display_name || p.email || "Unbekannt");
    }

    const runs = await Promise.all(
      (rows ?? []).map(async (row) => {
        let inputUrl: string | null = null;
        if (row.input_path && !row.purged_at) {
          const { data: signed } = await db.storage.from("uploads").createSignedUrl(row.input_path, 600);
          inputUrl = signed?.signedUrl ?? null;
        }
        const { input_path: _p, user_id, ...rest } = row;
        return {
          ...rest,
          mine: user_id === context.userId,
          who: user_id ? (names.get(user_id) ?? "Unbekannt") : "gelöscht (Frist abgelaufen)",
          inputUrl,
        };
      }),
    );
    return { runs, seesAll: seesAllRuns(role), pageSize: PAGE };
  });

/** Protokoll eines Durchlaufs. Einsicht in fremde Durchläufe wird selbst protokolliert. */
export const getRunEvents = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ runId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const db = await admin();
    const { data: run, error } = await db
      .from("runs")
      .select("id,board_id,output_node_id,user_id")
      .eq("id", data.runId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!run) throw new Error("Durchlauf nicht gefunden");
    const { seesAllRuns } = await import("@/lib/runs");
    const { role } = await outputFor(context.userId, run.output_node_id, "viewer");
    const mine = run.user_id === context.userId;
    if (!mine && !seesAllRuns(role)) throw new Error("Kein Zugriff auf diesen Durchlauf");
    if (!mine) {
      await logEvent({ runId: run.id, boardId: run.board_id, actorId: context.userId, action: "viewed" });
    }
    const { data: events } = await db
      .from("run_events")
      .select("id,action,detail,created_at,actor_id")
      .eq("run_id", run.id)
      .order("created_at", { ascending: true })
      .limit(200);
    return {
      events: (events ?? []).map(({ actor_id, ...e }) => ({
        ...e,
        byMe: actor_id === context.userId,
        system: actor_id === null,
      })),
    };
  });

/**
 * Testdurchlauf: legt das aktuelle Ergebnis als Durchlauf ab – mit Nachweis
 * (wer, wann, Motor, Prüfsummen). Der Canvas wird dabei nicht verändert.
 */
export const createTestRun = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ outputNodeId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { assertRate } = await import("@/lib/rate-limit.server");
    assertRate(`runs:${context.userId}`, 30, 60_000);
    const { node } = await outputFor(context.userId, data.outputNodeId, "editor");
    const { retentionDays, expiresAt, sha256Hex } = await import("@/lib/runs");
    const meta = (node.metadata ?? {}) as Record<string, unknown>;
    const output = (meta["output"] ?? {}) as Record<string, unknown>;
    const db = await admin();

    let engine = "manuell";
    let provider = "";
    let model = "";
    let checksum = "";
    const sourceId = typeof output["sourceId"] === "string" ? output["sourceId"] : null;
    if (sourceId) {
      const { data: source } = await db
        .from("nodes")
        .select("type,content,metadata,board_id")
        .eq("id", sourceId)
        .maybeSingle();
      if (source && source.board_id === node.board_id) {
        const sm = (source.metadata ?? {}) as Record<string, unknown>;
        engine = String(sm["engine"] ?? source.type ?? "manuell");
        provider = String(sm["provider"] ?? "");
        model = String(sm["model"] ?? "");
        checksum = await sha256Hex(`${source.content ?? ""}`);
      }
    }

    const resultJson = JSON.stringify(output);
    const { data: run, error } = await db
      .from("runs")
      .insert({
        board_id: node.board_id,
        output_node_id: node.id,
        user_id: context.userId,
        status: output["kind"] && output["kind"] !== "empty" ? "done" : "failed",
        engine,
        provider,
        model,
        context_checksum: checksum,
        result: output as never,
        result_sha256: await sha256Hex(resultJson),
        error: output["kind"] && output["kind"] !== "empty" ? null : "Noch kein Ergebnis am Ausgang",
        finished_at: new Date().toISOString(),
        expires_at: expiresAt(retentionDays(meta)),
      })
      .select("id,status")
      .single();
    if (error) throw new Error(error.message);
    await logEvent({ runId: run.id, boardId: node.board_id, actorId: context.userId, action: "created", detail: "Testdurchlauf" });
    await logEvent({ runId: run.id, boardId: node.board_id, actorId: context.userId, action: run.status });
    return { id: run.id, status: run.status };
  });

/** Löschfrist am Ergebnis-Modul setzen. Gilt für neue und noch nicht gelöschte Durchläufe. */
export const setRetention = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z.object({ outputNodeId: z.string().uuid(), days: z.number().int().refine((d) => (RETENTION_CHOICES as readonly number[]).includes(d), "Ungültige Frist") }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { node } = await outputFor(context.userId, data.outputNodeId, "editor");
    const db = await admin();
    const meta = { ...((node.metadata ?? {}) as Record<string, unknown>), retentionDays: data.days };
    const { error } = await db.from("nodes").update({ metadata: meta as never }).eq("id", node.id);
    if (error) throw new Error(error.message);

    // Bestehende Durchläufe an die neue Frist anpassen.
    const { data: open } = await db
      .from("runs")
      .select("id,created_at")
      .eq("output_node_id", node.id)
      .is("purged_at", null)
      .limit(2000);
    await Promise.all(
      (open ?? []).map((row) =>
        db
          .from("runs")
          .update({ expires_at: expiry(data.days, new Date(row.created_at).getTime()) })
          .eq("id", row.id),
      ),
    );
    return { ok: true, days: data.days };
  });

/** Scopes, in denen das Konto Rechte hat – mit tatsächlicher Rolle. */
async function myBoards(userId: string): Promise<Map<string, string>> {
  const db = await admin();
  const { boardRoleOf } = await import("@/lib/guard.server");
  const [own, member, teams, orgs] = await Promise.all([
    db.from("boards").select("id").eq("user_id", userId),
    db.from("board_members").select("board_id").eq("user_id", userId),
    db.from("team_members").select("team_id").eq("user_id", userId),
    db.from("organization_members").select("org_id,role").eq("user_id", userId),
  ]);
  const ids = new Set<string>();
  for (const row of own.data ?? []) ids.add(row.id);
  for (const row of member.data ?? []) ids.add(row.board_id);
  const teamIds = (teams.data ?? []).map((r) => r.team_id);
  if (teamIds.length) {
    const { data } = await db.from("board_team_access").select("board_id").in("team_id", teamIds);
    for (const row of data ?? []) ids.add(row.board_id);
  }
  const orgIds = (orgs.data ?? []).filter((r) => r.role === "owner" || r.role === "admin").map((r) => r.org_id);
  if (orgIds.length) {
    const { data } = await db.from("boards").select("id").in("org_id", orgIds);
    for (const row of data ?? []) ids.add(row.id);
  }
  const out = new Map<string, string>();
  await Promise.all(
    [...ids].slice(0, 300).map(async (id) => {
      const role = await boardRoleOf(userId, id);
      if (role) out.set(id, role);
    }),
  );
  return out;
}

/**
 * Galerie über alle Scopes: eigene Durchläufe plus – wo man verwaltet – die des Teams.
 * Modul-eigene Zugriffsregeln werden je Ausgang erneut geprüft.
 */
export const myResults = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({
        status: z.enum(["running", "done", "failed"]).optional(),
        days: z.number().int().min(1).max(365).optional(),
        boardId: z.string().uuid().optional(),
        mineOnly: z.boolean().default(false),
        page: z.number().int().min(0).max(200).default(0),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { seesAllRuns } = await import("@/lib/runs");
    const { nodeRoleOf } = await import("@/lib/guard.server");
    const db = await admin();
    const boards = await myBoards(context.userId);
    const managed = [...boards.entries()].filter(([, role]) => seesAllRuns(role)).map(([id]) => id);

    const base = () => {
      let q = db
        .from("runs")
        .select(
          "id,board_id,output_node_id,user_id,status,input_path,input_mime,engine,provider,model,result,error,created_at,expires_at,purged_at",
        )
        .order("created_at", { ascending: false })
        .limit(200);
      if (data.status) q = q.eq("status", data.status);
      if (data.boardId) q = q.eq("board_id", data.boardId);
      if (data.days) q = q.gte("created_at", new Date(Date.now() - data.days * 86_400_000).toISOString());
      return q;
    };

    const own = await base().eq("user_id", context.userId);
    if (own.error) throw new Error(own.error.message);
    let rows = own.data ?? [];
    if (!data.mineOnly && managed.length) {
      const team = await base().in("board_id", managed);
      if (team.error) throw new Error(team.error.message);
      const seen = new Set(rows.map((r) => r.id));
      rows = [...rows, ...(team.data ?? []).filter((r) => !seen.has(r.id))];
    }
    rows.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));

    // Zugriffsregeln am einzelnen Ausgang erneut prüfen.
    const nodeIds = [...new Set(rows.map((r) => r.output_node_id))].slice(0, 60);
    const allowed = new Set<string>();
    await Promise.all(
      nodeIds.map(async (id) => {
        if (await nodeRoleOf(context.userId, id)) allowed.add(id);
      }),
    );
    rows = rows.filter((r) => allowed.has(r.output_node_id));

    const PAGE_SIZE = 24;
    const total = rows.length;
    const pageRows = rows.slice(data.page * PAGE_SIZE, data.page * PAGE_SIZE + PAGE_SIZE);

    const boardIds = [...new Set(pageRows.map((r) => r.board_id))];
    const outIds = [...new Set(pageRows.map((r) => r.output_node_id))];
    const [boardRes, nodeRes] = await Promise.all([
      boardIds.length ? db.from("boards").select("id,title").in("id", boardIds) : Promise.resolve({ data: [] }),
      outIds.length ? db.from("nodes").select("id,title").in("id", outIds) : Promise.resolve({ data: [] }),
    ]);
    const boardTitle = new Map((boardRes.data ?? []).map((b) => [b.id, b.title]));
    const nodeTitle = new Map((nodeRes.data ?? []).map((n) => [n.id, n.title]));

    const runs = await Promise.all(
      pageRows.map(async (row) => {
        let inputUrl: string | null = null;
        if (row.input_path && !row.purged_at) {
          const { data: signed } = await db.storage.from("uploads").createSignedUrl(row.input_path, 600);
          inputUrl = signed?.signedUrl ?? null;
        }
        const { input_path: _p, user_id, ...rest } = row;
        return {
          ...rest,
          mine: user_id === context.userId,
          boardTitle: boardTitle.get(row.board_id) ?? "Scope",
          outputTitle: nodeTitle.get(row.output_node_id) ?? "Ergebnis",
          inputUrl,
        };
      }),
    );

    const scopes = [...boards.keys()];
    const { data: scopeRows } = scopes.length
      ? await db.from("boards").select("id,title").in("id", scopes).order("title")
      : { data: [] };

    return {
      runs,
      total,
      pageSize: PAGE_SIZE,
      scopes: (scopeRows ?? []).map((b) => ({ id: b.id, title: b.title })),
    };
  });
