-- 1. Apps: Beschreibung, MCP-Token und Rechteumfang
ALTER TABLE public.apps
  ADD COLUMN IF NOT EXISTS description text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS mcp_token uuid NOT NULL DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS mcp_scope text NOT NULL DEFAULT 'read';

ALTER TABLE public.apps DROP CONSTRAINT IF EXISTS apps_mcp_scope_check;
ALTER TABLE public.apps
  ADD CONSTRAINT apps_mcp_scope_check CHECK (mcp_scope IN ('read', 'write'));

-- 2. Rollen: viewer (lesen), member/editor (mitarbeiten)
UPDATE public.board_members SET role = 'member' WHERE role NOT IN ('member', 'viewer', 'editor');
ALTER TABLE public.board_members DROP CONSTRAINT IF EXISTS board_members_role_check;
ALTER TABLE public.board_members
  ADD CONSTRAINT board_members_role_check CHECK (role IN ('member', 'viewer', 'editor'));

-- 3. Lesen und Bearbeiten trennen
CREATE OR REPLACE FUNCTION private.can_read_board(_board uuid)
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

CREATE OR REPLACE FUNCTION private.can_edit_board(_board uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT auth.uid() IS NOT NULL AND (
    EXISTS (SELECT 1 FROM public.boards b WHERE b.id = _board AND b.user_id = auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.board_members m
      WHERE m.board_id = _board AND m.user_id = auth.uid() AND m.role IN ('member', 'editor')
    )
  );
$$;

REVOKE ALL ON FUNCTION private.can_read_board(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.can_read_board(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION private.can_read_node(_node uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.nodes n
    WHERE n.id = _node AND private.can_read_board(n.board_id)
  );
$$;
REVOKE ALL ON FUNCTION private.can_read_node(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.can_read_node(uuid) TO authenticated, service_role;

-- 4. Policies: Leser sehen, Bearbeiter ändern
DROP POLICY IF EXISTS "members read board" ON public.boards;
CREATE POLICY "members read board" ON public.boards
  FOR SELECT TO authenticated
  USING (private.can_read_board(id));

DROP POLICY IF EXISTS "board access nodes" ON public.nodes;
CREATE POLICY "board read nodes" ON public.nodes
  FOR SELECT TO authenticated USING (private.can_read_board(board_id));
CREATE POLICY "board insert nodes" ON public.nodes
  FOR INSERT TO authenticated WITH CHECK (private.can_edit_board(board_id));
CREATE POLICY "board update nodes" ON public.nodes
  FOR UPDATE TO authenticated USING (private.can_edit_board(board_id)) WITH CHECK (private.can_edit_board(board_id));
CREATE POLICY "board delete nodes" ON public.nodes
  FOR DELETE TO authenticated USING (private.can_edit_board(board_id));

DROP POLICY IF EXISTS "board access edges" ON public.edges;
CREATE POLICY "board read edges" ON public.edges
  FOR SELECT TO authenticated USING (private.can_read_board(board_id));
CREATE POLICY "board insert edges" ON public.edges
  FOR INSERT TO authenticated WITH CHECK (private.can_edit_board(board_id));
CREATE POLICY "board update edges" ON public.edges
  FOR UPDATE TO authenticated USING (private.can_edit_board(board_id)) WITH CHECK (private.can_edit_board(board_id));
CREATE POLICY "board delete edges" ON public.edges
  FOR DELETE TO authenticated USING (private.can_edit_board(board_id));

-- Chats bleiben persönlich, dürfen aber auch Lesern offenstehen
CREATE OR REPLACE FUNCTION private.can_access_node(_node uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.nodes n
    WHERE n.id = _node AND private.can_read_board(n.board_id)
  );
$$;
