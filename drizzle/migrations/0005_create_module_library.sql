CREATE TABLE public.module_library (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  title text NOT NULL DEFAULT 'Modul',
  description text,
  tags text[] NOT NULL DEFAULT '{}',
  scope text NOT NULL DEFAULT 'single',
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  share_token uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  is_public boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.module_library_shares (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  library_id uuid NOT NULL REFERENCES public.module_library(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  email text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (library_id, user_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.module_library TO authenticated;
GRANT ALL ON public.module_library TO service_role;
GRANT SELECT ON public.module_library TO anon;
GRANT SELECT, INSERT, DELETE ON public.module_library_shares TO authenticated;
GRANT ALL ON public.module_library_shares TO service_role;

CREATE OR REPLACE FUNCTION public.is_library_owner(_entry uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.module_library WHERE id = _entry AND user_id = auth.uid()
  )
$$;

CREATE OR REPLACE FUNCTION public.can_read_library(_entry uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.module_library e
    WHERE e.id = _entry
      AND (e.user_id = auth.uid() OR e.is_public
           OR EXISTS (SELECT 1 FROM public.module_library_shares s
                      WHERE s.library_id = e.id AND s.user_id = auth.uid()))
  )
$$;

REVOKE EXECUTE ON FUNCTION public.is_library_owner(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.can_read_library(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_library_owner(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_read_library(uuid) TO authenticated;

ALTER TABLE public.module_library ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.module_library_shares ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own library entries" ON public.module_library
  FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE POLICY "shared library entries readable" ON public.module_library
  FOR SELECT TO authenticated
  USING (public.can_read_library(id));

CREATE POLICY "public library entries readable" ON public.module_library
  FOR SELECT TO anon, authenticated
  USING (is_public = true);

CREATE POLICY "owner manages library shares" ON public.module_library_shares
  FOR ALL TO authenticated
  USING (public.is_library_owner(library_id)) WITH CHECK (public.is_library_owner(library_id));

CREATE POLICY "recipients read their shares" ON public.module_library_shares
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE TRIGGER module_library_touch
  BEFORE UPDATE ON public.module_library
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();