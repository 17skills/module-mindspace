CREATE TABLE public.captures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  board_id uuid NOT NULL,
  app_id uuid,
  node_id uuid NOT NULL,
  photo_path text,
  lat double precision,
  lon double precision,
  source text NOT NULL DEFAULT 'manuell',
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX captures_node_idx ON public.captures (node_id, created_at DESC);
GRANT SELECT ON public.captures TO authenticated;
GRANT ALL ON public.captures TO service_role;
ALTER TABLE public.captures ENABLE ROW LEVEL SECURITY;
CREATE POLICY "board read captures" ON public.captures FOR SELECT TO authenticated
  USING (private.can_read_board(board_id));
CREATE OR REPLACE FUNCTION public.captures_append_only() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  RAISE EXCEPTION 'captures ist nur anhängbar';
END $$;
CREATE TRIGGER captures_lock BEFORE UPDATE ON public.captures
  FOR EACH ROW EXECUTE FUNCTION public.captures_append_only();
COMMENT ON TABLE public.captures IS 'Fotoaufnahmen aus Kamera-Apps: eine Zeile je Foto, gleichzeitige Erfassung ohne Schreibkonflikt am Modul.';