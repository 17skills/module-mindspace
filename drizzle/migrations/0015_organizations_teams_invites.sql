-- 1. Organisationen und Teams
DO $$ BEGIN
  CREATE TYPE public.org_role AS ENUM ('owner', 'admin', 'member', 'guest');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL DEFAULT 'Meine Organisation',
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.organizations TO authenticated;
GRANT ALL ON public.organizations TO service_role;
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.organization_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.org_role NOT NULL DEFAULT 'member',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, user_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.organization_members TO authenticated;
GRANT ALL ON public.organization_members TO service_role;
ALTER TABLE public.organization_members ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.teams (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name text NOT NULL DEFAULT 'Neues Team',
  description text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.teams TO authenticated;
GRANT ALL ON public.teams TO service_role;
ALTER TABLE public.teams ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.team_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (team_id, user_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.team_members TO authenticated;
GRANT ALL ON public.team_members TO service_role;
ALTER TABLE public.team_members ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.board_team_access (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  board_id uuid NOT NULL REFERENCES public.boards(id) ON DELETE CASCADE,
  team_id uuid NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'viewer' CHECK (role IN ('viewer', 'editor')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (board_id, team_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.board_team_access TO authenticated;
GRANT ALL ON public.board_team_access TO service_role;
ALTER TABLE public.board_team_access ENABLE ROW LEVEL SECURITY;

-- 2. Einladungen (Organisation oder Scope)
CREATE TABLE IF NOT EXISTS public.invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
  board_id uuid REFERENCES public.boards(id) ON DELETE CASCADE,
  team_id uuid REFERENCES public.teams(id) ON DELETE SET NULL,
  email text NOT NULL,
  org_role public.org_role NOT NULL DEFAULT 'member',
  board_role text NOT NULL DEFAULT 'viewer' CHECK (board_role IN ('viewer', 'editor')),
  token text NOT NULL UNIQUE DEFAULT encode(extensions.gen_random_bytes(18), 'hex'),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'revoked')),
  invited_by uuid NOT NULL,
  email_sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '14 days')
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.invites TO authenticated;
GRANT ALL ON public.invites TO service_role;
ALTER TABLE public.invites ENABLE ROW LEVEL SECURITY;

-- 3. Zugehörigkeit bestehender Daten
ALTER TABLE public.boards ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE;
ALTER TABLE public.apps ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE;
ALTER TABLE public.module_library ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE;
ALTER TABLE public.ai_usage ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL;

-- Für jedes bestehende Konto eine Organisation anlegen
INSERT INTO public.organizations (name, created_by)
SELECT COALESCE(NULLIF(p.display_name, ''), split_part(COALESCE(p.email, 'Konto'), '@', 1)) || ' – Organisation', p.id
FROM public.profiles p
WHERE NOT EXISTS (SELECT 1 FROM public.organizations o WHERE o.created_by = p.id);

INSERT INTO public.organization_members (org_id, user_id, role)
SELECT o.id, o.created_by, 'owner'
FROM public.organizations o
ON CONFLICT (org_id, user_id) DO NOTHING;

UPDATE public.boards b SET org_id = o.id FROM public.organizations o WHERE o.created_by = b.user_id AND b.org_id IS NULL;
UPDATE public.apps a SET org_id = o.id FROM public.organizations o WHERE o.created_by = a.user_id AND a.org_id IS NULL;
UPDATE public.module_library m SET org_id = o.id FROM public.organizations o WHERE o.created_by = m.user_id AND m.org_id IS NULL;

-- Bestehende Scope-Einladungen übernehmen
INSERT INTO public.invites (board_id, email, board_role, token, status, invited_by, created_at, expires_at)
SELECT bi.board_id, bi.email, bi.role, bi.token, bi.status, bi.invited_by, bi.created_at, bi.expires_at
FROM public.board_invites bi
ON CONFLICT (token) DO NOTHING;

-- 4. Hilfsfunktionen (ohne Rekursion in den Policies)
CREATE OR REPLACE FUNCTION private.org_role_of(_org uuid)
RETURNS public.org_role
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT m.role FROM public.organization_members m
  WHERE m.org_id = _org AND m.user_id = auth.uid()
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION private.is_org_member(_org uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.organization_members m
    WHERE m.org_id = _org AND m.user_id = auth.uid()
  );
$$;

CREATE OR REPLACE FUNCTION private.is_org_admin(_org uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.organization_members m
    WHERE m.org_id = _org AND m.user_id = auth.uid() AND m.role IN ('owner', 'admin')
  );
$$;

CREATE OR REPLACE FUNCTION private.team_board_role(_board uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE WHEN bool_or(a.role = 'editor') THEN 'editor' ELSE 'viewer' END
  FROM public.board_team_access a
  JOIN public.team_members tm ON tm.team_id = a.team_id AND tm.user_id = auth.uid()
  WHERE a.board_id = _board
  HAVING count(*) > 0;
$$;

CREATE OR REPLACE FUNCTION private.can_read_board(_board uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT auth.uid() IS NOT NULL AND (
    EXISTS (SELECT 1 FROM public.boards b WHERE b.id = _board AND b.user_id = auth.uid())
    OR EXISTS (SELECT 1 FROM public.board_members m WHERE m.board_id = _board AND m.user_id = auth.uid())
    OR private.team_board_role(_board) IS NOT NULL
    OR EXISTS (
      SELECT 1 FROM public.boards b
      JOIN public.organization_members om ON om.org_id = b.org_id AND om.user_id = auth.uid()
      WHERE b.id = _board AND om.role IN ('owner', 'admin')
    )
  );
$$;

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
    OR private.team_board_role(_board) = 'editor'
    OR EXISTS (
      SELECT 1 FROM public.boards b
      JOIN public.organization_members om ON om.org_id = b.org_id AND om.user_id = auth.uid()
      WHERE b.id = _board AND om.role IN ('owner', 'admin')
    )
  );
$$;

-- 5. Policies
DROP POLICY IF EXISTS "org members read org" ON public.organizations;
CREATE POLICY "org members read org" ON public.organizations
  FOR SELECT TO authenticated USING (private.is_org_member(id));
DROP POLICY IF EXISTS "org admins update org" ON public.organizations;
CREATE POLICY "org admins update org" ON public.organizations
  FOR UPDATE TO authenticated USING (private.is_org_admin(id)) WITH CHECK (private.is_org_admin(id));
DROP POLICY IF EXISTS "create own org" ON public.organizations;
CREATE POLICY "create own org" ON public.organizations
  FOR INSERT TO authenticated WITH CHECK (created_by = auth.uid());

DROP POLICY IF EXISTS "read org members" ON public.organization_members;
CREATE POLICY "read org members" ON public.organization_members
  FOR SELECT TO authenticated USING (user_id = auth.uid() OR private.is_org_member(org_id));
DROP POLICY IF EXISTS "admins manage org members" ON public.organization_members;
CREATE POLICY "admins manage org members" ON public.organization_members
  FOR ALL TO authenticated USING (private.is_org_admin(org_id)) WITH CHECK (private.is_org_admin(org_id));

DROP POLICY IF EXISTS "read teams" ON public.teams;
CREATE POLICY "read teams" ON public.teams
  FOR SELECT TO authenticated USING (private.is_org_member(org_id));
DROP POLICY IF EXISTS "admins manage teams" ON public.teams;
CREATE POLICY "admins manage teams" ON public.teams
  FOR ALL TO authenticated USING (private.is_org_admin(org_id)) WITH CHECK (private.is_org_admin(org_id));

DROP POLICY IF EXISTS "read team members" ON public.team_members;
CREATE POLICY "read team members" ON public.team_members
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR EXISTS (SELECT 1 FROM public.teams t WHERE t.id = team_id AND private.is_org_member(t.org_id)));
DROP POLICY IF EXISTS "admins manage team members" ON public.team_members;
CREATE POLICY "admins manage team members" ON public.team_members
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.teams t WHERE t.id = team_id AND private.is_org_admin(t.org_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM public.teams t WHERE t.id = team_id AND private.is_org_admin(t.org_id)));

DROP POLICY IF EXISTS "read board team access" ON public.board_team_access;
CREATE POLICY "read board team access" ON public.board_team_access
  FOR SELECT TO authenticated USING (private.can_read_board(board_id));
DROP POLICY IF EXISTS "owner manages board team access" ON public.board_team_access;
CREATE POLICY "owner manages board team access" ON public.board_team_access
  FOR ALL TO authenticated USING (private.is_board_owner(board_id)) WITH CHECK (private.is_board_owner(board_id));

DROP POLICY IF EXISTS "read invites" ON public.invites;
CREATE POLICY "read invites" ON public.invites
  FOR SELECT TO authenticated
  USING (
    (org_id IS NOT NULL AND private.is_org_admin(org_id))
    OR (board_id IS NOT NULL AND private.is_board_owner(board_id))
  );
DROP POLICY IF EXISTS "manage invites" ON public.invites;
CREATE POLICY "manage invites" ON public.invites
  FOR ALL TO authenticated
  USING (
    (org_id IS NOT NULL AND private.is_org_admin(org_id))
    OR (board_id IS NOT NULL AND private.is_board_owner(board_id))
  )
  WITH CHECK (
    (org_id IS NOT NULL AND private.is_org_admin(org_id))
    OR (board_id IS NOT NULL AND private.is_board_owner(board_id))
  );

DROP POLICY IF EXISTS "org members read org boards" ON public.boards;
CREATE POLICY "org members read org boards" ON public.boards
  FOR SELECT TO authenticated USING (org_id IS NOT NULL AND private.is_org_admin(org_id));

-- 6. Indizes
CREATE INDEX IF NOT EXISTS organization_members_user_idx ON public.organization_members (user_id);
CREATE INDEX IF NOT EXISTS organization_members_org_role_idx ON public.organization_members (org_id, role);
CREATE INDEX IF NOT EXISTS team_members_user_idx ON public.team_members (user_id);
CREATE INDEX IF NOT EXISTS board_team_access_board_idx ON public.board_team_access (board_id);
CREATE INDEX IF NOT EXISTS boards_org_idx ON public.boards (org_id);
CREATE INDEX IF NOT EXISTS apps_org_idx ON public.apps (org_id);
CREATE INDEX IF NOT EXISTS invites_email_idx ON public.invites (lower(email), status);
CREATE INDEX IF NOT EXISTS ai_usage_org_idx ON public.ai_usage (org_id, created_at DESC);

DROP TRIGGER IF EXISTS organizations_touch ON public.organizations;
CREATE TRIGGER organizations_touch BEFORE UPDATE ON public.organizations
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();