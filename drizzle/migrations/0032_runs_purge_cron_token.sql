CREATE SCHEMA IF NOT EXISTS private;
CREATE TABLE IF NOT EXISTS private.cron_tokens (name text PRIMARY KEY, token text NOT NULL);
REVOKE ALL ON private.cron_tokens FROM PUBLIC, anon, authenticated;
INSERT INTO private.cron_tokens (name, token)
VALUES ('runs_purge', encode(extensions.gen_random_bytes(32), 'hex'))
ON CONFLICT (name) DO NOTHING;

CREATE OR REPLACE FUNCTION public.verify_cron_token(_name text, _token text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM private.cron_tokens WHERE name = _name AND token = _token)
$$;
REVOKE EXECUTE ON FUNCTION public.verify_cron_token(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.verify_cron_token(text, text) TO service_role;