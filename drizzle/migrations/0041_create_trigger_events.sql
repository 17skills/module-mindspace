CREATE TABLE public.trigger_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trigger_id uuid REFERENCES public.scope_triggers(id) ON DELETE SET NULL,
  board_id uuid NOT NULL,
  trigger_name text NOT NULL DEFAULT '',
  source text NOT NULL,
  status text NOT NULL,
  reason text NOT NULL DEFAULT '',
  runs integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX trigger_events_created_idx ON public.trigger_events (created_at DESC);
GRANT SELECT ON public.trigger_events TO authenticated;
GRANT ALL ON public.trigger_events TO service_role;
ALTER TABLE public.trigger_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read trigger events" ON public.trigger_events FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));
CREATE OR REPLACE FUNCTION public.trigger_events_append_only() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF TG_OP = 'DELETE' AND OLD.created_at < now() - interval '90 days' THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'trigger_events ist nur anhängbar';
END $$;
CREATE TRIGGER trigger_events_lock BEFORE UPDATE OR DELETE ON public.trigger_events
  FOR EACH ROW EXECUTE FUNCTION public.trigger_events_append_only();
CREATE EXTENSION IF NOT EXISTS pg_cron;
SELECT cron.schedule('trigger-events-purge', '17 3 * * *', $$DELETE FROM public.trigger_events WHERE created_at < now() - interval '90 days'$$);