ALTER TABLE public.query_templates ADD COLUMN last_used_at timestamptz;
COMMENT ON COLUMN public.query_templates.last_used_at IS 'Zuletzt angewendet (für Sortierung „zuletzt verwendet“)';