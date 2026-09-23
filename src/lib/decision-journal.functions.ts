/**
 * Entscheidungs-Journal: unveränderliches Gedächtnis der Urteile und die
 * Rückkopplung der menschlichen Ausgänge aus dem Ablagefach.
 *
 * Invarianten:
 *  - Ein geschriebenes Urteil wird nie überschrieben (Datenbank-Trigger).
 *  - Ein Ausgang wird genau einmal nachgetragen — nie automatisch.
 *  - Ohne Ausgang gilt ein Urteil als offen, nie als bestätigt.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { calibrate, type Calibration, type JournalPoint } from "@/lib/runtime/calibration";

const Entry = z.object({
  questionId: z.string().min(1),
  questionText: z.string().default(""),
  questionType: z.enum(["choice", "score", "noul"]).default("noul"),
  verdict: z.string().default(""),
  probability: z.number().nullable().optional(),
  confidence: z.number().nullable().optional(),
  minConfidence: z.number().default(80),
});

/** Schreibt die Urteile eines Laufs fest und gibt ihre Journal-Kennungen zurück. */
export const appendJournal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({
        boardId: z.string().uuid(),
        nodeId: z.string().uuid(),
        contextChecksum: z.string().default(""),
        ontologyDigest: z.string().default(""),
        engine: z.string().default(""),
        provider: z.string().default(""),
        entries: z.array(Entry).min(1),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const rows = data.entries.map((entry) => ({
      board_id: data.boardId,
      node_id: data.nodeId,
      user_id: context.userId,
      question_id: entry.questionId,
      question_text: entry.questionText.slice(0, 2000),
      question_type: entry.questionType,
      verdict: entry.verdict.slice(0, 500),
      probability: entry.probability ?? null,
      confidence: entry.confidence ?? null,
      min_confidence: Math.round(entry.minConfidence),
      context_checksum: data.contextChecksum,
      ontology_digest: data.ontologyDigest,
      engine: data.engine,
      provider: data.provider,
    }));

    const { data: written, error } = await context.supabase
      .from("decision_journal")
      .insert(rows)
      .select("id, question_id");
    if (error) throw new Error(error.message);

    const ids: Record<string, string> = {};
    for (const row of written ?? []) ids[row.question_id] = row.id;
    return { ids, at: new Date().toISOString() };
  });

/** Trägt den menschlichen Ausgang zu offenen Urteilen nach (Little Bets). */
export const closeJournal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({
        ids: z.array(z.string().uuid()).min(1),
        outcome: z.enum(["released", "discarded"]),
        by: z.string().default(""),
        note: z.string().default(""),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: updated, error } = await context.supabase
      .from("decision_journal")
      .update({
        outcome: data.outcome,
        outcome_by: data.by.slice(0, 200),
        outcome_note: data.note.slice(0, 2000),
        outcome_at: new Date().toISOString(),
      })
      .in("id", data.ids)
      .is("outcome", null)
      .select("id");
    if (error) throw new Error(error.message);
    return { closed: (updated ?? []).length };
  });

/**
 * Trägt eine fehlende Sicherheit von Hand nach — genau einmal, für das
 * jüngste Urteil dieser Frage. Das Urteil selbst bleibt unangetastet.
 */
export const rateJournal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({
        nodeId: z.string().uuid(),
        questionId: z.string().min(1),
        confidence: z.number(),
        by: z.string().default(""),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: row, error: readError } = await context.supabase
      .from("decision_journal")
      .select("id")
      .eq("node_id", data.nodeId)
      .eq("question_id", data.questionId)
      .is("human_confidence", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (readError) throw new Error(readError.message);
    if (!row) return { rated: 0 };

    const value = Math.min(1, Math.max(0, data.confidence));
    const { error } = await context.supabase
      .from("decision_journal")
      .update({ human_confidence: value, human_confidence_by: data.by.slice(0, 200) })
      .eq("id", row.id);
    if (error) throw new Error(error.message);
    return { rated: 1 };
  });

/** Kalibrierung einer Entscheidungskarte: Urteil gegen tatsächlichen Ausgang. */
export const loadCalibration = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({
        nodeId: z.string().uuid(),
        basis: z.enum(["release", "followed"]).default("release"),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<Calibration> => {
    const { data: rows, error } = await context.supabase
      .from("decision_journal")
      .select("confidence, human_confidence, probability, question_type, outcome")
      .eq("node_id", data.nodeId)
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw new Error(error.message);

    const points: JournalPoint[] = (rows ?? []).map((row) => ({
      confidence: row.confidence === null ? null : Number(row.confidence),
      humanConfidence: row.human_confidence === null ? null : Number(row.human_confidence),
      probability: row.probability === null ? null : Number(row.probability),
      yes:
        row.question_type === "noul" && row.probability !== null
          ? Number(row.probability) >= 0.5
          : null,
      outcome: (row.outcome as JournalPoint["outcome"]) ?? null,
    }));
    return calibrate(points, { basis: data.basis });
  });
