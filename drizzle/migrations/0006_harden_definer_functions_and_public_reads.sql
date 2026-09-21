-- 1) Remove anonymous/public direct reads: public sharing is served through
--    server-side code only, so share_token and user_id are never exposed.
DROP POLICY IF EXISTS "public boards readable" ON public.boards;
DROP POLICY IF EXISTS "public library entries readable" ON public.module_library;
REVOKE SELECT ON public.boards FROM anon;
REVOKE SELECT ON public.module_library FROM anon;

-- 2) Move SECURITY DEFINER helpers out of the exposed API schema.
DROP POLICY IF EXISTS "members read own membership" ON public.board_members;
DROP POLICY IF EXISTS "owner manages members" ON public.board_members;
DROP POLICY IF EXISTS "members read board" ON public.boards;
DROP POLICY IF EXISTS "board access nodes" ON public.nodes;
DROP POLICY IF EXISTS "board access edges" ON public.edges;
DROP POLICY IF EXISTS "shared library entries readable" ON public.module_library;
DROP POLICY IF EXISTS "owner manages library shares" ON public.module_library_shares;

DROP FUNCTION IF EXISTS public.is_board_owner(uuid);
DROP FUNCTION IF EXISTS public.can_edit_board(uuid);
DROP FUNCTION IF EXISTS public.is_library_owner(uuid);
DROP FUNCTION IF EXISTS public.can_read_library(uuid);

CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon;
GRANT USAGE ON SCHEMA private TO authenticated, service_role;

CREATE FUNCTION private.is_board_owner(_board uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT EXISTS (SELECT 1 FROM public.boards b WHERE b.id = _board AND b.user_id = auth.uid());
$$;

CREATE FUNCTION private.can_edit_board(_board uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT EXISTS (SELECT 1 FROM public.boards b WHERE b.id = _board AND b.user_id = auth.uid())
      OR EXISTS (SELECT 1 FROM public.board_members m WHERE m.board_id = _board AND m.user_id = auth.uid());
$$;

CREATE FUNCTION private.is_library_owner(_entry uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT EXISTS (SELECT 1 FROM public.module_library WHERE id = _entry AND user_id = auth.uid());
$$;

CREATE FUNCTION private.can_read_library(_entry uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.module_library e
    WHERE e.id = _entry
      AND (e.user_id = auth.uid()
           OR EXISTS (SELECT 1 FROM public.module_library_shares s
                      WHERE s.library_id = e.id AND s.user_id = auth.uid()))
  );
$$;

REVOKE ALL ON FUNCTION private.is_board_owner(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.can_edit_board(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.is_library_owner(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.can_read_library(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.is_board_owner(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.can_edit_board(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.is_library_owner(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.can_read_library(uuid) TO authenticated, service_role;

-- 3) Recreate the policies against the relocated helpers.
CREATE POLICY "members read own membership" ON public.board_members
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR private.is_board_owner(board_id));

CREATE POLICY "owner manages members" ON public.board_members
  FOR ALL TO authenticated
  USING (private.is_board_owner(board_id))
  WITH CHECK (private.is_board_owner(board_id));

CREATE POLICY "members read board" ON public.boards
  FOR SELECT TO authenticated
  USING (private.can_edit_board(id));

CREATE POLICY "board access nodes" ON public.nodes
  FOR ALL TO authenticated
  USING (private.can_edit_board(board_id))
  WITH CHECK (private.can_edit_board(board_id));

CREATE POLICY "board access edges" ON public.edges
  FOR ALL TO authenticated
  USING (private.can_edit_board(board_id))
  WITH CHECK (private.can_edit_board(board_id));

CREATE POLICY "shared library entries readable" ON public.module_library
  FOR SELECT TO authenticated
  USING (private.can_read_library(id));

CREATE POLICY "owner manages library shares" ON public.module_library_shares
  FOR ALL TO authenticated
  USING (private.is_library_owner(library_id))
  WITH CHECK (private.is_library_owner(library_id));