CREATE TABLE IF NOT EXISTS public.board_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  board_id uuid NOT NULL REFERENCES public.boards(id) ON DELETE CASCADE,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  label text,
  kind text NOT NULL DEFAULT 'manuell',
  node_count integer NOT NULL DEFAULT 0,
  edge_count integer NOT NULL DEFAULT 0,
  snapshot jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS board_versions_board_created_idx
  ON public.board_versions (board_id, created_at DESC);

GRANT SELECT ON public.board_versions TO authenticated;
GRANT ALL ON public.board_versions TO service_role;

ALTER TABLE public.board_versions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "board access reads versions" ON public.board_versions;
CREATE POLICY "board access reads versions" ON public.board_versions
  FOR SELECT TO authenticated USING (private.can_edit_board(board_id));