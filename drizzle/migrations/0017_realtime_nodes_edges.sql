ALTER TABLE public.nodes REPLICA IDENTITY FULL;
ALTER TABLE public.edges REPLICA IDENTITY FULL;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.nodes;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.edges;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;