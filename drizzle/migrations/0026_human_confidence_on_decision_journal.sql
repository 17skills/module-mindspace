ALTER TABLE public.decision_journal
  ADD COLUMN IF NOT EXISTS human_confidence numeric,
  ADD COLUMN IF NOT EXISTS human_confidence_by text;

-- Der Mensch darf eine fehlende Sicherheit genau einmal nachtragen.
CREATE OR REPLACE FUNCTION public.decision_journal_immutable()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
  IF OLD.human_confidence IS NOT NULL THEN
    NEW.human_confidence := OLD.human_confidence;
    NEW.human_confidence_by := OLD.human_confidence_by;
  END IF;
  RETURN NEW;
END;
$$;