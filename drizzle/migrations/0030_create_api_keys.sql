CREATE TABLE public.api_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  board_id uuid NOT NULL REFERENCES public.boards(id) ON DELETE CASCADE,
  name text NOT NULL DEFAULT '',
  key_hash text NOT NULL UNIQUE,
  prefix text NOT NULL DEFAULT '',
  created_by uuid,
  last_used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX api_keys_board_idx ON public.api_keys (board_id, created_at DESC);

GRANT SELECT ON public.api_keys TO authenticated;
GRANT ALL ON public.api_keys TO service_role;
ALTER TABLE public.api_keys ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Schlüssel des eigenen Scopes lesen" ON public.api_keys
  FOR SELECT TO authenticated USING (private.can_edit_board(board_id));

ALTER TABLE public.runs ADD COLUMN IF NOT EXISTS origin text NOT NULL DEFAULT 'app';
ALTER TABLE public.runs ADD COLUMN IF NOT EXISTS api_key_id uuid;