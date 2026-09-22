CREATE TABLE public.mcp_servers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  url text NOT NULL,
  auth_kind text NOT NULL DEFAULT 'none',
  header_name text,
  encrypted_token text,
  tools jsonb NOT NULL DEFAULT '[]'::jsonb,
  server_info jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_check_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mcp_servers_auth_kind_check CHECK (auth_kind IN ('none','bearer','header'))
);

CREATE INDEX mcp_servers_user_idx ON public.mcp_servers (user_id, created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.mcp_servers TO authenticated;
GRANT ALL ON public.mcp_servers TO service_role;

ALTER TABLE public.mcp_servers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own mcp servers select" ON public.mcp_servers
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "own mcp servers insert" ON public.mcp_servers
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own mcp servers update" ON public.mcp_servers
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own mcp servers delete" ON public.mcp_servers
  FOR DELETE TO authenticated USING (auth.uid() = user_id);