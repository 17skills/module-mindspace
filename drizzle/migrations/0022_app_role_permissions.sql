ALTER TABLE public.apps
  ADD COLUMN IF NOT EXISTS access_mode text NOT NULL DEFAULT 'public';

ALTER TABLE public.apps DROP CONSTRAINT IF EXISTS apps_access_mode_check;
ALTER TABLE public.apps
  ADD CONSTRAINT apps_access_mode_check CHECK (access_mode IN ('public', 'org', 'restricted'));

CREATE TABLE public.app_permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id uuid NOT NULL REFERENCES public.apps(id) ON DELETE CASCADE,
  subject_type text NOT NULL CHECK (subject_type IN ('user', 'team')),
  subject_id uuid NOT NULL,
  role text NOT NULL CHECK (role IN ('viewer', 'data_editor', 'config_admin')),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (app_id, subject_type, subject_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.app_permissions TO authenticated;
GRANT ALL ON public.app_permissions TO service_role;

ALTER TABLE public.app_permissions ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION private.app_role_rank(_role text)
RETURNS integer
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE _role
    WHEN 'viewer' THEN 1
    WHEN 'data_editor' THEN 2
    WHEN 'config_admin' THEN 3
    ELSE 0
  END;
$$;

CREATE OR REPLACE FUNCTION private.app_role_of(_app uuid)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _user uuid := auth.uid();
  _owner uuid;
  _org uuid;
  _mode text;
  _rank integer := 0;
BEGIN
  SELECT user_id, org_id, access_mode INTO _owner, _org, _mode
  FROM public.apps WHERE id = _app;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF _user IS NULL THEN
    RETURN CASE WHEN _mode = 'public' THEN 'viewer' ELSE NULL END;
  END IF;
  IF _owner = _user THEN RETURN 'config_admin'; END IF;
  IF _org IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.organization_members om
    WHERE om.org_id = _org AND om.user_id = _user AND om.role IN ('owner', 'admin')
  ) THEN
    RETURN 'config_admin';
  END IF;
  SELECT COALESCE(MAX(private.app_role_rank(p.role)), 0) INTO _rank
  FROM public.app_permissions p
  WHERE p.app_id = _app AND (
    (p.subject_type = 'user' AND p.subject_id = _user)
    OR (p.subject_type = 'team' AND EXISTS (
      SELECT 1 FROM public.team_members tm
      WHERE tm.team_id = p.subject_id AND tm.user_id = _user
    ))
  );
  IF _mode = 'public' THEN _rank := GREATEST(_rank, 1); END IF;
  IF _mode = 'org' AND _org IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.organization_members om
    WHERE om.org_id = _org AND om.user_id = _user
  ) THEN
    _rank := GREATEST(_rank, 1);
  END IF;
  RETURN CASE _rank WHEN 3 THEN 'config_admin' WHEN 2 THEN 'data_editor' WHEN 1 THEN 'viewer' ELSE NULL END;
END;
$$;

CREATE OR REPLACE FUNCTION private.can_view_app(_app uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.apps a
    WHERE a.id = _app
      AND a.is_public
      AND a.access_revoked_at IS NULL
      AND (a.access_expires_at IS NULL OR a.access_expires_at > now())
      AND private.app_role_rank(private.app_role_of(a.id)) >= 1
  );
$$;

CREATE OR REPLACE FUNCTION private.can_update_app_data(_app uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT private.app_role_rank(private.app_role_of(_app)) >= 2;
$$;

CREATE OR REPLACE FUNCTION private.can_configure_app(_app uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT private.app_role_rank(private.app_role_of(_app)) >= 3;
$$;

REVOKE ALL ON FUNCTION private.app_role_rank(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.app_role_of(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.can_view_app(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.can_update_app_data(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.can_configure_app(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.app_role_rank(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.app_role_of(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.can_view_app(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.can_update_app_data(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.can_configure_app(uuid) TO authenticated, service_role;

CREATE POLICY "app viewers read permissions" ON public.app_permissions
  FOR SELECT TO authenticated
  USING (private.can_view_app(app_id));
CREATE POLICY "app config admins manage permissions" ON public.app_permissions
  FOR ALL TO authenticated
  USING (private.can_configure_app(app_id))
  WITH CHECK (private.can_configure_app(app_id));

DROP POLICY IF EXISTS "Owner reads own apps" ON public.apps;
DROP POLICY IF EXISTS "Owner updates own apps" ON public.apps;
DROP POLICY IF EXISTS "Owner deletes own apps" ON public.apps;
CREATE POLICY "authorized users read apps" ON public.apps
  FOR SELECT TO authenticated USING (private.can_view_app(id));
CREATE POLICY "config admins update apps" ON public.apps
  FOR UPDATE TO authenticated USING (private.can_configure_app(id)) WITH CHECK (private.can_configure_app(id));
CREATE POLICY "config admins delete apps" ON public.apps
  FOR DELETE TO authenticated USING (private.can_configure_app(id));

CREATE INDEX IF NOT EXISTS app_permissions_app_idx ON public.app_permissions (app_id);
CREATE INDEX IF NOT EXISTS app_permissions_subject_idx ON public.app_permissions (subject_type, subject_id);
CREATE INDEX IF NOT EXISTS apps_org_access_idx ON public.apps (org_id, access_mode);