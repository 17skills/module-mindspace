CREATE TABLE public.runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  board_id uuid NOT NULL REFERENCES public.boards(id) ON DELETE CASCADE,
  output_node_id uuid NOT NULL REFERENCES public.nodes(id) ON DELETE CASCADE,
  app_id uuid REFERENCES public.apps(id) ON DELETE SET NULL,
  user_id uuid,
  status text NOT NULL DEFAULT 'running',
  input_path text,
  input_sha256 text,
  input_mime text,
  engine text NOT NULL DEFAULT '',
  provider text NOT NULL DEFAULT '',
  model text NOT NULL DEFAULT '',
  context_checksum text NOT NULL DEFAULT '',
  result jsonb NOT NULL DEFAULT '{}'::jsonb,
  result_sha256 text NOT NULL DEFAULT '',
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  expires_at timestamptz NOT NULL DEFAULT now() + interval '30 days',
  purged_at timestamptz
);
CREATE INDEX runs_output_idx ON public.runs (output_node_id, created_at DESC);
CREATE INDEX runs_expires_idx ON public.runs (expires_at) WHERE purged_at IS NULL;

GRANT SELECT ON public.runs TO authenticated;
GRANT ALL ON public.runs TO service_role;
ALTER TABLE public.runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Eigene Durchläufe lesen" ON public.runs FOR SELECT TO authenticated USING (user_id = auth.uid());

CREATE TABLE public.run_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL,
  board_id uuid NOT NULL,
  actor_id uuid,
  action text NOT NULL,
  detail text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX run_events_run_idx ON public.run_events (run_id, created_at);
GRANT ALL ON public.run_events TO service_role;
ALTER TABLE public.run_events ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.run_events_append_only()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  RAISE EXCEPTION 'Das Protokoll ist unveränderlich';
END;
$$;
CREATE TRIGGER run_events_no_update BEFORE UPDATE OR DELETE ON public.run_events
FOR EACH ROW EXECUTE FUNCTION public.run_events_append_only();