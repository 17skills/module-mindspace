-- Neue Konten bekommen sofort eine eigene Organisation
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _org uuid;
  _label text;
BEGIN
  INSERT INTO public.profiles (id, email, display_name)
  VALUES (NEW.id, NEW.email, COALESCE(NEW.raw_user_meta_data ->> 'full_name', split_part(NEW.email, '@', 1)))
  ON CONFLICT (id) DO NOTHING;

  _label := COALESCE(NULLIF(NEW.raw_user_meta_data ->> 'full_name', ''), split_part(COALESCE(NEW.email, 'Konto'), '@', 1));
  INSERT INTO public.organizations (name, created_by)
  VALUES (_label || ' – Organisation', NEW.id)
  RETURNING id INTO _org;

  INSERT INTO public.organization_members (org_id, user_id, role)
  VALUES (_org, NEW.id, 'owner')
  ON CONFLICT (org_id, user_id) DO NOTHING;

  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;

-- Anmeldungen eines Kontos: datensparsame Übersicht und Zwangsabmeldung
CREATE OR REPLACE FUNCTION public.list_user_sessions(_user uuid)
RETURNS TABLE (id uuid, created_at timestamptz, refreshed_at timestamptz, user_agent text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT s.id, s.created_at, s.refreshed_at, s.user_agent
  FROM auth.sessions s
  WHERE s.user_id = _user
  ORDER BY s.created_at DESC
  LIMIT 50;
$$;
REVOKE EXECUTE ON FUNCTION public.list_user_sessions(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_user_sessions(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.end_user_sessions(_user uuid, _session uuid DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _count integer;
BEGIN
  DELETE FROM auth.sessions s
  WHERE s.user_id = _user AND (_session IS NULL OR s.id = _session);
  GET DIAGNOSTICS _count = ROW_COUNT;
  RETURN _count;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.end_user_sessions(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.end_user_sessions(uuid, uuid) TO service_role;

-- Für Einladungen benötigte Eindeutigkeit
CREATE UNIQUE INDEX IF NOT EXISTS board_members_board_user_key ON public.board_members (board_id, user_id);