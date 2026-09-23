DROP POLICY IF EXISTS "authorized users read apps" ON public.apps;
CREATE POLICY "config admins read app configuration" ON public.apps
  FOR SELECT TO authenticated
  USING (private.can_configure_app(id));

COMMENT ON POLICY "config admins read app configuration" ON public.apps IS
  'Viewer and data-editor delivery reads use guarded server functions, preventing MCP credential disclosure.';