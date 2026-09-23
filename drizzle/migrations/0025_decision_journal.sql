CREATE TABLE IF NOT EXISTS public.decision_journal (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  board_id uuid NOT NULL REFERENCES public.boards(id) ON DELETE CASCADE,
  node_id uuid NOT NULL REFERENCES public.nodes(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  question_id text NOT NULL,
  question_text text NOT NULL DEFAULT '',
  question_type text NOT NULL DEFAULT 'noul',
  verdict text NOT NULL DEFAULT '',
  probability numeric(6,4),
  confidence numeric(6,4),
  min_confidence integer NOT NULL DEFAULT 80,
  context_checksum text NOT NULL DEFAULT '',
  ontology_digest text NOT NULL DEFAULT '',
  engine text NOT NULL DEFAULT '',
  provider text NOT NULL DEFAULT '',
  outcome text CHECK (outcome IN ('released','discarded')),
  outcome_by text,
  outcome_note text,
  outcome_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS decision_journal_node_idx ON public.decision_journal (node_id, created_at DESC);
CREATE INDEX IF NOT EXISTS decision_journal_board_idx ON public.decision_journal (board_id, created_at DESC);

GRANT SELECT, INSERT, UPDATE ON public.decision_journal TO authenticated;
GRANT ALL ON public.decision_journal TO service_role;
ALTER TABLE public.decision_journal ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "read decision journal" ON public.decision_journal;
CREATE POLICY "read decision journal" ON public.decision_journal FOR SELECT TO authenticated
  USING (private.can_read_node(node_id));

DROP POLICY IF EXISTS "write decision journal" ON public.decision_journal;
CREATE POLICY "write decision journal" ON public.decision_journal FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND private.can_edit_node(node_id));

DROP POLICY IF EXISTS "close decision journal" ON public.decision_journal;
CREATE POLICY "close decision journal" ON public.decision_journal FOR UPDATE TO authenticated
  USING (private.can_edit_node(node_id)) WITH CHECK (private.can_edit_node(node_id));

CREATE OR REPLACE FUNCTION public.decision_journal_immutable()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  NEW.id := OLD.id;
  NEW.board_id := OLD.board_id;
  NEW.node_id := OLD.node_id;
  NEW.user_id := OLD.user_id;
  NEW.question_id := OLD.question_id;
  NEW.question_text := OLD.question_text;
  NEW.question_type := OLD.question_type;
  NEW.verdict := OLD.verdict;
  NEW.probability := OLD.probability;
  NEW.confidence := OLD.confidence;
  NEW.min_confidence := OLD.min_confidence;
  NEW.context_checksum := OLD.context_checksum;
  NEW.ontology_digest := OLD.ontology_digest;
  NEW.engine := OLD.engine;
  NEW.provider := OLD.provider;
  NEW.created_at := OLD.created_at;
  IF OLD.outcome IS NOT NULL THEN
    NEW.outcome := OLD.outcome;
    NEW.outcome_by := OLD.outcome_by;
    NEW.outcome_note := OLD.outcome_note;
    NEW.outcome_at := OLD.outcome_at;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS decision_journal_immutable_trg ON public.decision_journal;
CREATE TRIGGER decision_journal_immutable_trg
  BEFORE UPDATE ON public.decision_journal
  FOR EACH ROW EXECUTE FUNCTION public.decision_journal_immutable();