CREATE TABLE public.inspection_findings (
  id text PRIMARY KEY,
  board_id uuid NOT NULL REFERENCES public.boards(id) ON DELETE CASCADE,
  node_id uuid NOT NULL REFERENCES public.nodes(id) ON DELETE CASCADE,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX inspection_findings_node_idx ON public.inspection_findings (node_id, created_at);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.inspection_findings TO authenticated;
GRANT ALL ON public.inspection_findings TO service_role;
ALTER TABLE public.inspection_findings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "board read findings" ON public.inspection_findings FOR SELECT TO authenticated
  USING (private.can_read_board(board_id));
CREATE POLICY "board insert findings" ON public.inspection_findings FOR INSERT TO authenticated
  WITH CHECK (private.can_edit_board(board_id));
CREATE POLICY "board update findings" ON public.inspection_findings FOR UPDATE TO authenticated
  USING (private.can_edit_board(board_id)) WITH CHECK (private.can_edit_board(board_id));
CREATE POLICY "board delete findings" ON public.inspection_findings FOR DELETE TO authenticated
  USING (private.can_edit_board(board_id));
CREATE TRIGGER inspection_findings_touch BEFORE UPDATE ON public.inspection_findings
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
INSERT INTO public.inspection_findings (id, board_id, node_id, data, created_at)
SELECT DISTINCT ON (f->>'id')
  f->>'id', n.board_id, n.id, f,
  COALESCE(NULLIF(f->>'createdAt','')::timestamptz, n.created_at)
FROM public.nodes n
CROSS JOIN LATERAL jsonb_array_elements(n.metadata->'findings') f
WHERE n.type = 'inspect' AND jsonb_typeof(n.metadata->'findings') = 'array' AND f ? 'id'
ON CONFLICT (id) DO NOTHING;
COMMENT ON TABLE public.inspection_findings IS 'Inspektionsbefunde: eine Zeile je Befund, damit viele Erfasser gleichzeitig senden, ohne dass das Modul überschrieben wird.';