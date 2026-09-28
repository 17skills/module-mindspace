ALTER TABLE public.query_templates
  ADD COLUMN category text NOT NULL DEFAULT '' CHECK (char_length(category) <= 60),
  ADD COLUMN tags text[] NOT NULL DEFAULT '{}' CHECK (cardinality(tags) <= 20);
CREATE INDEX query_templates_tags_idx ON public.query_templates USING gin(tags);