ALTER TABLE public.scope_triggers ADD COLUMN log_values boolean NOT NULL DEFAULT false;
ALTER TABLE public.scope_triggers ADD COLUMN log_exclude text[] NOT NULL DEFAULT '{}';