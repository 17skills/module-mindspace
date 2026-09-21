-- 1. Pin search_path on the remaining trigger function
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- 2. Lock down EXECUTE on SECURITY DEFINER functions
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.is_board_owner(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_edit_board(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.touch_updated_at() FROM PUBLIC, anon, authenticated;
-- authenticated keeps EXECUTE only where RLS policies evaluate these helpers
GRANT EXECUTE ON FUNCTION public.is_board_owner(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_edit_board(uuid) TO authenticated;

-- 3. Constrain board member roles so roles can never be escalated to owner
UPDATE public.board_members SET role = 'member' WHERE role NOT IN ('member', 'viewer');
ALTER TABLE public.board_members
  ADD CONSTRAINT board_members_role_check CHECK (role IN ('member', 'viewer'));

-- 4. Make publicly shared boards readable without breaking owner-only access
GRANT SELECT ON public.boards TO anon;
CREATE POLICY "public boards readable" ON public.boards
  FOR SELECT TO anon, authenticated
  USING (is_public = true);
