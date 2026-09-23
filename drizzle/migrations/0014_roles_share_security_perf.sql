-- 1. Rollen je Scope vereinheitlichen: nur noch 'viewer' und 'editor'
UPDATE public.board_members SET role = 'editor' WHERE role IN ('member', 'owner');
UPDATE public.board_members SET role = 'viewer' WHERE role NOT IN ('editor', 'viewer');
ALTER TABLE public.board_members ALTER COLUMN role SET DEFAULT 'viewer';
ALTER TABLE public.board_members DROP CONSTRAINT IF EXISTS board_members_role_check;
ALTER TABLE public.board_members ADD CONSTRAINT board_members_role_check CHECK (role IN ('viewer', 'editor'));

ALTER TABLE public.board_invites ALTER COLUMN role SET DEFAULT 'viewer';
ALTER TABLE public.board_invites DROP CONSTRAINT IF EXISTS board_invites_role_check;
ALTER TABLE public.board_invites ADD CONSTRAINT board_invites_role_check CHECK (role IN ('viewer', 'editor'));

CREATE OR REPLACE FUNCTION private.can_edit_board(_board uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT auth.uid() IS NOT NULL AND (
    EXISTS (SELECT 1 FROM public.boards b WHERE b.id = _board AND b.user_id = auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.board_members m
      WHERE m.board_id = _board AND m.user_id = auth.uid() AND m.role = 'editor'
    )
  );
$$;

-- 2. Freigaben: Ablauf, Widerruf, optionaler Passwortschutz
ALTER TABLE public.boards
  ADD COLUMN IF NOT EXISTS share_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS share_revoked_at timestamptz,
  ADD COLUMN IF NOT EXISTS share_password_hash text,
  ADD COLUMN IF NOT EXISTS share_last_used_at timestamptz;

ALTER TABLE public.apps
  ADD COLUMN IF NOT EXISTS access_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS access_revoked_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_access_at timestamptz;

-- 3. Indizes für schnelleres Laden bei wachsenden Datenmengen
CREATE INDEX IF NOT EXISTS edges_source_idx ON public.edges (source_id);
CREATE INDEX IF NOT EXISTS edges_target_idx ON public.edges (target_id);
CREATE INDEX IF NOT EXISTS board_members_user_idx ON public.board_members (user_id);
CREATE INDEX IF NOT EXISTS apps_mcp_token_idx ON public.apps (mcp_token);
CREATE INDEX IF NOT EXISTS audit_log_subject_idx ON public.audit_log (subject_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS nodes_board_updated_idx ON public.nodes (board_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS boards_share_lookup_idx ON public.boards (share_token) WHERE is_public;
CREATE INDEX IF NOT EXISTS profiles_email_idx ON public.profiles (lower(email));

-- 4. Ausführungsrechte für erhöhte Datenbankfunktionen einschränken
REVOKE EXECUTE ON FUNCTION public.purge_audit_log() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.purge_audit_log() TO service_role;