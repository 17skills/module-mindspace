ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS branding jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.organizations.branding IS 'Standard-Branding der Organisation: Name, Logo, Akzentfarbe. Apps erben diese Werte, solange sie kein eigenes Branding setzen.';