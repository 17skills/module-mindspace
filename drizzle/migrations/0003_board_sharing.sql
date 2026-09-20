-- 1. Board sharing columns
ALTER TABLE public.boards
  ADD COLUMN IF NOT EXISTS share_token uuid NOT NULL DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS is_public boolean NOT NULL DEFAULT false;

CREATE UNIQUE INDEX IF NOT EXISTS boards_share_token_key ON public.boards (share_token);

-- 2. Members
CREATE TABLE IF NOT EXISTS public.board_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  board_id uuid NOT NULL REFERENCES public.boards(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'member',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (board_id, user_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.board_members TO authenticated;
GRANT ALL ON public.board_members TO service_role;

ALTER TABLE public.board_members ENABLE ROW LEVEL SECURITY;

-- 3. Access helpers
CREATE OR REPLACE FUNCTION public.is_board_owner(_board uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.boards b WHERE b.id = _board AND b.user_id = auth.uid());
$$;

CREATE OR REPLACE FUNCTION public.can_edit_board(_board uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.boards b WHERE b.id = _board AND b.user_id = auth.uid())
      OR EXISTS (SELECT 1 FROM public.board_members m WHERE m.board_id = _board AND m.user_id = auth.uid());
$$;

-- 4. Policies
CREATE POLICY "members read own membership" ON public.board_members
  FOR SELECT TO authenticated USING (user_id = auth.uid() OR public.is_board_owner(board_id));
CREATE POLICY "owner manages members" ON public.board_members
  FOR ALL TO authenticated USING (public.is_board_owner(board_id)) WITH CHECK (public.is_board_owner(board_id));

CREATE POLICY "members read board" ON public.boards
  FOR SELECT TO authenticated USING (public.can_edit_board(id));

DROP POLICY IF EXISTS "own nodes" ON public.nodes;
CREATE POLICY "board access nodes" ON public.nodes
  FOR ALL TO authenticated USING (public.can_edit_board(board_id)) WITH CHECK (public.can_edit_board(board_id));

DROP POLICY IF EXISTS "own edges" ON public.edges;
CREATE POLICY "board access edges" ON public.edges
  FOR ALL TO authenticated USING (public.can_edit_board(board_id)) WITH CHECK (public.can_edit_board(board_id));
