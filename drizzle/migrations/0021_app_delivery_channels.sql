ALTER TABLE public.apps
  ADD COLUMN IF NOT EXISTS channels jsonb NOT NULL DEFAULT '{"web": true, "teams": false, "mcp": true}'::jsonb,
  ADD COLUMN IF NOT EXISTS audience text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS lead_question text NOT NULL DEFAULT '';