CREATE TABLE public.scope_triggers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  board_id uuid NOT NULL REFERENCES public.boards(id) ON DELETE CASCADE,
  node_id uuid NOT NULL REFERENCES public.nodes(id) ON DELETE CASCADE,
  created_by uuid,
  name text NOT NULL DEFAULT '',
  mode text NOT NULL DEFAULT 'webhook',
  enabled boolean NOT NULL DEFAULT true,
  secret_hash text NOT NULL,
  prefix text NOT NULL DEFAULT '',
  interval_minutes integer,
  probe_url text,
  match_mode text NOT NULL DEFAULT 'any',
  conditions jsonb NOT NULL DEFAULT '[]'::jsonb,
  last_values jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_status text,
  last_detail text,
  last_event_at timestamptz,
  last_run_at timestamptz,
  next_run_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX scope_triggers_board_idx ON public.scope_triggers (board_id);
CREATE INDEX scope_triggers_node_idx ON public.scope_triggers (node_id);
CREATE INDEX scope_triggers_due_idx ON public.scope_triggers (next_run_at) WHERE enabled;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.scope_triggers TO authenticated;
GRANT ALL ON public.scope_triggers TO service_role;

ALTER TABLE public.scope_triggers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Auslöser des eigenen Scopes lesen"
  ON public.scope_triggers FOR SELECT
  TO authenticated
  USING (private.can_read_board(board_id));

CREATE POLICY "Auslöser anlegen"
  ON public.scope_triggers FOR INSERT
  TO authenticated
  WITH CHECK (private.can_edit_board(board_id));

CREATE POLICY "Auslöser ändern"
  ON public.scope_triggers FOR UPDATE
  TO authenticated
  USING (private.can_edit_board(board_id))
  WITH CHECK (private.can_edit_board(board_id));

CREATE POLICY "Auslöser löschen"
  ON public.scope_triggers FOR DELETE
  TO authenticated
  USING (private.can_edit_board(board_id));

CREATE TRIGGER scope_triggers_touch
  BEFORE UPDATE ON public.scope_triggers
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();