CREATE TABLE public.datasets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  board_id uuid NOT NULL REFERENCES public.boards(id) ON DELETE CASCADE,
  node_id uuid REFERENCES public.nodes(id) ON DELETE SET NULL,
  version integer NOT NULL DEFAULT 1,
  checksum text NOT NULL DEFAULT '',
  schema jsonb NOT NULL DEFAULT '[]'::jsonb,
  row_count integer NOT NULL DEFAULT 0,
  storage_path text,
  origin_kind text NOT NULL DEFAULT 'upload',
  verified boolean NOT NULL DEFAULT false,
  source_url text,
  fetched_at timestamptz,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX datasets_node_idx ON public.datasets(node_id, version DESC);
CREATE INDEX datasets_board_idx ON public.datasets(board_id);

GRANT SELECT, INSERT ON public.datasets TO authenticated;
GRANT ALL ON public.datasets TO service_role;
ALTER TABLE public.datasets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Datasets readable with scope access" ON public.datasets
  FOR SELECT TO authenticated
  USING (CASE WHEN node_id IS NULL THEN private.board_role(board_id) IS NOT NULL
              ELSE private.node_role(node_id) IS NOT NULL END);

CREATE POLICY "Editors add dataset versions" ON public.datasets
  FOR INSERT TO authenticated
  WITH CHECK (created_by = auth.uid() AND node_id IS NOT NULL AND private.can_edit_node(node_id));

ALTER TABLE public.runs ADD COLUMN input_refs jsonb NOT NULL DEFAULT '[]'::jsonb;