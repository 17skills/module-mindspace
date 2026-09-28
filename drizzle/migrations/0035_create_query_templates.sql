CREATE TABLE public.query_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 120),
  config jsonb NOT NULL,
  columns text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.query_templates TO authenticated;
GRANT ALL ON public.query_templates TO service_role;
ALTER TABLE public.query_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own query templates" ON public.query_templates FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE INDEX query_templates_user_idx ON public.query_templates(user_id, created_at DESC);