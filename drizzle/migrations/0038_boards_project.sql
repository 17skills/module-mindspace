ALTER TABLE public.boards ADD COLUMN IF NOT EXISTS project text;
COMMENT ON COLUMN public.boards.project IS 'Optionales Projekt (Ordner) zur Gruppierung von Scopes';
CREATE INDEX IF NOT EXISTS boards_project_idx ON public.boards (user_id, project);