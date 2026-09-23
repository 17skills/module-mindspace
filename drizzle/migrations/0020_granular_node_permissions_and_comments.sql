-- 1. Rolle "commenter" (Kommentieren) überall erlauben
ALTER TABLE public.board_members DROP CONSTRAINT IF EXISTS board_members_role_check;
ALTER TABLE public.board_members ADD CONSTRAINT board_members_role_check CHECK (role IN ('viewer','commenter','editor'));
ALTER TABLE public.board_invites DROP CONSTRAINT IF EXISTS board_invites_role_check;
ALTER TABLE public.board_invites ADD CONSTRAINT board_invites_role_check CHECK (role IN ('viewer','commenter','editor'));
ALTER TABLE public.board_team_access DROP CONSTRAINT IF EXISTS board_team_access_role_check;
ALTER TABLE public.board_team_access ADD CONSTRAINT board_team_access_role_check CHECK (role IN ('viewer','commenter','editor'));

-- 2. Feingranulare Rechte je Modul oder Hintergrundfeld
CREATE TABLE IF NOT EXISTS public.node_permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  board_id uuid NOT NULL REFERENCES public.boards(id) ON DELETE CASCADE,
  node_id uuid NOT NULL REFERENCES public.nodes(id) ON DELETE CASCADE,
  subject_type text NOT NULL CHECK (subject_type IN ('default','user','team')),
  subject_id uuid,
  role text NOT NULL CHECK (role IN ('viewer','commenter','editor')),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((subject_type = 'default' AND subject_id IS NULL) OR (subject_type <> 'default' AND subject_id IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS node_permissions_unique_idx
  ON public.node_permissions (node_id, subject_type, COALESCE(subject_id, '00000000-0000-0000-0000-000000000000'::uuid));
CREATE INDEX IF NOT EXISTS node_permissions_board_idx ON public.node_permissions (board_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.node_permissions TO authenticated;
GRANT ALL ON public.node_permissions TO service_role;
ALTER TABLE public.node_permissions ENABLE ROW LEVEL SECURITY;

-- 3. Kommentare an Modulen
CREATE TABLE IF NOT EXISTS public.node_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  board_id uuid NOT NULL REFERENCES public.boards(id) ON DELETE CASCADE,
  node_id uuid NOT NULL REFERENCES public.nodes(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  body text NOT NULL,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS node_comments_node_idx ON public.node_comments (node_id, created_at);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.node_comments TO authenticated;
GRANT ALL ON public.node_comments TO service_role;
ALTER TABLE public.node_comments ENABLE ROW LEVEL SECURITY;

-- 4. Rollenberechnung
CREATE OR REPLACE FUNCTION private.role_rank(_role text)
RETURNS int LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE _role WHEN 'owner' THEN 4 WHEN 'editor' THEN 3 WHEN 'commenter' THEN 2 WHEN 'viewer' THEN 1 ELSE 0 END;
$$;

CREATE OR REPLACE FUNCTION private.board_role(_board uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE
    WHEN auth.uid() IS NULL THEN NULL
    WHEN EXISTS (SELECT 1 FROM public.boards b WHERE b.id = _board AND b.user_id = auth.uid()) THEN 'owner'
    ELSE (
      SELECT CASE max(r)
        WHEN 3 THEN 'editor' WHEN 2 THEN 'commenter' WHEN 1 THEN 'viewer' ELSE NULL END
      FROM (
        SELECT private.role_rank(m.role) AS r FROM public.board_members m
          WHERE m.board_id = _board AND m.user_id = auth.uid()
        UNION ALL
        SELECT private.role_rank(a.role) FROM public.board_team_access a
          JOIN public.team_members tm ON tm.team_id = a.team_id AND tm.user_id = auth.uid()
          WHERE a.board_id = _board
        UNION ALL
        SELECT 3 FROM public.boards b
          JOIN public.organization_members om ON om.org_id = b.org_id AND om.user_id = auth.uid()
          WHERE b.id = _board AND om.role IN ('owner','admin')
      ) s
    )
  END;
$$;

CREATE OR REPLACE FUNCTION private.node_role(_node uuid)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  n record;
  base text;
  base_rank int;
  over_rank int;
BEGIN
  SELECT id, parent_id, board_id INTO n FROM public.nodes WHERE id = _node;
  IF n IS NULL THEN RETURN NULL; END IF;
  base := private.board_role(n.board_id);
  IF base IS NULL THEN RETURN NULL; END IF;
  IF base = 'owner' THEN RETURN 'owner'; END IF;
  base_rank := private.role_rank(base);

  -- Regel am Modul selbst, sonst am umgebenden Hintergrundfeld
  SELECT max(private.role_rank(p.role)) INTO over_rank
  FROM public.node_permissions p
  WHERE p.node_id = _node
    AND (p.subject_type = 'default'
      OR (p.subject_type = 'user' AND p.subject_id = auth.uid())
      OR (p.subject_type = 'team' AND EXISTS (
            SELECT 1 FROM public.team_members tm
            WHERE tm.team_id = p.subject_id AND tm.user_id = auth.uid())));

  IF over_rank IS NULL AND n.parent_id IS NOT NULL THEN
    SELECT max(private.role_rank(p.role)) INTO over_rank
    FROM public.node_permissions p
    WHERE p.node_id = n.parent_id
      AND (p.subject_type = 'default'
        OR (p.subject_type = 'user' AND p.subject_id = auth.uid())
        OR (p.subject_type = 'team' AND EXISTS (
              SELECT 1 FROM public.team_members tm
              WHERE tm.team_id = p.subject_id AND tm.user_id = auth.uid())));
  END IF;

  IF over_rank IS NOT NULL AND over_rank < base_rank THEN
    base_rank := over_rank;
  END IF;

  RETURN CASE base_rank WHEN 3 THEN 'editor' WHEN 2 THEN 'commenter' WHEN 1 THEN 'viewer' ELSE NULL END;
END;
$$;

CREATE OR REPLACE FUNCTION private.can_edit_node(_node uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT private.role_rank(private.node_role(_node)) >= 3;
$$;

CREATE OR REPLACE FUNCTION private.can_comment_node(_node uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT private.role_rank(private.node_role(_node)) >= 2;
$$;

REVOKE EXECUTE ON FUNCTION private.role_rank(text), private.board_role(uuid), private.node_role(uuid),
  private.can_edit_node(uuid), private.can_comment_node(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.board_role(uuid), private.node_role(uuid),
  private.can_edit_node(uuid), private.can_comment_node(uuid) TO authenticated, service_role;

-- 5. Regeln greifen lassen
DROP POLICY IF EXISTS "board update nodes" ON public.nodes;
CREATE POLICY "board update nodes" ON public.nodes FOR UPDATE TO authenticated
  USING (private.can_edit_node(id)) WITH CHECK (private.can_edit_board(board_id));
DROP POLICY IF EXISTS "board delete nodes" ON public.nodes;
CREATE POLICY "board delete nodes" ON public.nodes FOR DELETE TO authenticated
  USING (private.can_edit_node(id));

DROP POLICY IF EXISTS "read node permissions" ON public.node_permissions;
CREATE POLICY "read node permissions" ON public.node_permissions FOR SELECT TO authenticated
  USING (private.can_read_board(board_id));
DROP POLICY IF EXISTS "manage node permissions" ON public.node_permissions;
CREATE POLICY "manage node permissions" ON public.node_permissions FOR ALL TO authenticated
  USING (private.can_edit_board(board_id)) WITH CHECK (private.can_edit_board(board_id));

DROP POLICY IF EXISTS "read node comments" ON public.node_comments;
CREATE POLICY "read node comments" ON public.node_comments FOR SELECT TO authenticated
  USING (private.can_read_node(node_id));
DROP POLICY IF EXISTS "write node comments" ON public.node_comments;
CREATE POLICY "write node comments" ON public.node_comments FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND private.can_comment_node(node_id));
DROP POLICY IF EXISTS "update own comments" ON public.node_comments;
CREATE POLICY "update own comments" ON public.node_comments FOR UPDATE TO authenticated
  USING (user_id = auth.uid() OR private.is_board_owner(board_id))
  WITH CHECK (user_id = auth.uid() OR private.is_board_owner(board_id));
DROP POLICY IF EXISTS "delete own comments" ON public.node_comments;
CREATE POLICY "delete own comments" ON public.node_comments FOR DELETE TO authenticated
  USING (user_id = auth.uid() OR private.is_board_owner(board_id));

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.node_comments;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;