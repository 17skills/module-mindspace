CREATE TABLE public.apps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  board_id uuid NOT NULL REFERENCES public.boards(id) ON DELETE CASCADE,
  title text NOT NULL DEFAULT 'Neue App',
  kind text NOT NULL DEFAULT 'cockpit' CHECK (kind IN ('capture', 'cockpit')),
  node_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  branding jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_public boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.apps TO authenticated;
GRANT ALL ON public.apps TO service_role;

ALTER TABLE public.apps ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owner reads own apps" ON public.apps
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Owner creates own apps" ON public.apps
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Owner updates own apps" ON public.apps
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Owner deletes own apps" ON public.apps
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE INDEX apps_board_id_idx ON public.apps (board_id);
CREATE INDEX apps_user_id_idx ON public.apps (user_id);