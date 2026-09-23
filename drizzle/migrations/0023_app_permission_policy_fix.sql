DROP POLICY IF EXISTS "authorized users read apps" ON public.apps;
CREATE POLICY "authorized users read apps" ON public.apps
  FOR SELECT TO authenticated
  USING (private.can_view_app(id) OR private.can_configure_app(id));

DROP POLICY IF EXISTS "app viewers read permissions" ON public.app_permissions;
CREATE POLICY "app viewers read permissions" ON public.app_permissions
  FOR SELECT TO authenticated
  USING (private.app_role_rank(private.app_role_of(app_id)) >= 1);

COMMENT ON COLUMN public.apps.is_public IS 'Publication state. Access audience is controlled separately by access_mode.';