CREATE OR REPLACE FUNCTION private.can_access_node(_node uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.nodes n
    WHERE n.id = _node
      AND private.can_edit_board(n.board_id)
  );
$$;

DROP POLICY IF EXISTS "own chat" ON public.chat_messages;

CREATE POLICY "own chat select" ON public.chat_messages
FOR SELECT TO authenticated
USING (user_id = auth.uid() AND private.can_access_node(node_id));

CREATE POLICY "own chat insert" ON public.chat_messages
FOR INSERT TO authenticated
WITH CHECK (user_id = auth.uid() AND private.can_access_node(node_id));

CREATE POLICY "own chat update" ON public.chat_messages
FOR UPDATE TO authenticated
USING (user_id = auth.uid() AND private.can_access_node(node_id))
WITH CHECK (user_id = auth.uid() AND private.can_access_node(node_id));

CREATE POLICY "own chat delete" ON public.chat_messages
FOR DELETE TO authenticated
USING (user_id = auth.uid() AND private.can_access_node(node_id));

CREATE OR REPLACE FUNCTION private.is_board_owner(_board uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.boards b WHERE b.id = _board AND b.user_id = auth.uid()
  );
$$;

CREATE OR REPLACE FUNCTION private.can_edit_board(_board uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT auth.uid() IS NOT NULL AND (
    EXISTS (SELECT 1 FROM public.boards b WHERE b.id = _board AND b.user_id = auth.uid())
    OR EXISTS (SELECT 1 FROM public.board_members m WHERE m.board_id = _board AND m.user_id = auth.uid())
  );
$$;

CREATE OR REPLACE FUNCTION private.is_library_owner(_entry uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.module_library WHERE id = _entry AND user_id = auth.uid()
  );
$$;

CREATE OR REPLACE FUNCTION private.can_read_library(_entry uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.module_library e
    WHERE e.id = _entry
      AND (e.user_id = auth.uid()
           OR EXISTS (SELECT 1 FROM public.module_library_shares s
                      WHERE s.library_id = e.id AND s.user_id = auth.uid()))
  );
$$;

GRANT USAGE ON SCHEMA private TO authenticated;
GRANT EXECUTE ON FUNCTION private.can_access_node(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION private.is_board_owner(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION private.can_edit_board(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION private.is_library_owner(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION private.can_read_library(uuid) TO authenticated;
