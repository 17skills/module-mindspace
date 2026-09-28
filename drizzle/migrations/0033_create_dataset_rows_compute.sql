-- Relationale Zeilenablage: Tabellen werden in der Datenbank gefiltert und
-- gerechnet (Compute Pushdown), statt als Datei in den Serverspeicher zu laden.
CREATE TABLE public.dataset_rows (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  dataset_id uuid NOT NULL REFERENCES public.datasets(id) ON DELETE CASCADE,
  row_index integer NOT NULL,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  lat double precision,
  lon double precision
);

CREATE INDEX dataset_rows_dataset_idx ON public.dataset_rows(dataset_id, row_index);
CREATE INDEX dataset_rows_geo_idx ON public.dataset_rows(dataset_id, lat, lon)
  WHERE lat IS NOT NULL AND lon IS NOT NULL;

GRANT SELECT, INSERT ON public.dataset_rows TO authenticated;
GRANT ALL ON public.dataset_rows TO service_role;
ALTER TABLE public.dataset_rows ENABLE ROW LEVEL SECURITY;

-- Sichtbarkeit erbt exakt die Rechte der Datenquelle (RLS auf public.datasets).
CREATE POLICY "Dataset rows follow dataset access" ON public.dataset_rows
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.datasets d WHERE d.id = dataset_rows.dataset_id));

CREATE POLICY "Editors insert dataset rows" ON public.dataset_rows
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.datasets d
    WHERE d.id = dataset_rows.dataset_id
      AND d.node_id IS NOT NULL
      AND private.can_edit_node(d.node_id)
  ));

-- Robuste Zahlenlesung: unbrauchbare Zellen liefern NULL statt eines Fehlers.
CREATE OR REPLACE FUNCTION private.to_num(_t text)
RETURNS numeric
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $fn$
BEGIN
  RETURN replace(btrim(_t), ',', '.')::numeric;
EXCEPTION WHEN others THEN
  RETURN NULL;
END;
$fn$;

-- Baut aus der Filterliste eine sichere SQL-Bedingung (Werte immer literal-escaped).
CREATE OR REPLACE FUNCTION private.dataset_predicate(_filters jsonb)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $fn$
DECLARE
  f jsonb;
  col text;
  op text;
  val text;
  x text;
  cmp text;
  arr text[];
  parts text[] := ARRAY[]::text[];
BEGIN
  IF _filters IS NULL OR jsonb_typeof(_filters) <> 'array' THEN
    RETURN 'true';
  END IF;
  FOR f IN SELECT * FROM jsonb_array_elements(_filters) LOOP
    col := f->>'column';
    op := coalesce(f->>'op', 'eq');
    CONTINUE WHEN col IS NULL;
    x := format('(r.data->>%L)', col);
    val := CASE WHEN jsonb_typeof(f->'value') = 'null' THEN NULL ELSE f->'value'#>>'{}' END;
    IF op = 'filled' THEN
      cmp := format('btrim(coalesce(%s, '''')) <> ''''', x);
    ELSIF op = 'contains' THEN
      cmp := format('lower(coalesce(%s, '''')) LIKE %L', x, '%' || lower(coalesce(val, '')) || '%');
    ELSIF op = 'oneOf' THEN
      SELECT coalesce(array_agg(e#>>'{}'), ARRAY[]::text[]) INTO arr
      FROM jsonb_array_elements(CASE WHEN jsonb_typeof(f->'value') = 'array' THEN f->'value' ELSE '[]'::jsonb END) e;
      cmp := format('%s = ANY(%L::text[])', x, arr);
    ELSIF op IN ('eq', 'neq') THEN
      cmp := format(
        '(CASE WHEN private.to_num(%s) IS NOT NULL AND private.to_num(%L) IS NOT NULL'
        || ' THEN private.to_num(%s) = private.to_num(%L)'
        || ' ELSE coalesce(%s, '''') = %L END)',
        x, val, x, val, x, coalesce(val, ''));
      IF op = 'neq' THEN
        cmp := format('NOT %s', cmp);
      END IF;
    ELSIF op IN ('gt', 'gte', 'lt', 'lte') THEN
      cmp := format('private.to_num(%s) %s private.to_num(%L)', x,
        CASE op WHEN 'gt' THEN '>' WHEN 'gte' THEN '>=' WHEN 'lt' THEN '<' ELSE '<=' END, val);
    ELSE
      CONTINUE;
    END IF;
    parts := parts || cmp;
  END LOOP;
  IF array_length(parts, 1) IS NULL THEN
    RETURN 'true';
  END IF;
  RETURN array_to_string(parts, ' AND ');
END;
$fn$;

-- Aggregation direkt in der Datenbank: zurück kommen nur die Gruppenwerte.
CREATE OR REPLACE FUNCTION public.dataset_aggregate(
  _dataset uuid,
  _filters jsonb DEFAULT '[]'::jsonb,
  _group_by text DEFAULT NULL,
  _measure text DEFAULT NULL,
  _fn text DEFAULT 'count'
)
RETURNS TABLE(bucket text, value numeric, cnt bigint, matched bigint, total bigint)
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $fn$
DECLARE
  pred text;
  _total bigint;
  _matched bigint;
BEGIN
  IF _fn NOT IN ('count', 'sum', 'avg', 'min', 'max') THEN
    RAISE EXCEPTION 'Nicht unterstützte Berechnung: %', _fn;
  END IF;
  pred := private.dataset_predicate(_filters);
  SELECT count(*) INTO _total FROM public.dataset_rows r WHERE r.dataset_id = _dataset;
  EXECUTE format(
    'SELECT count(*)::bigint FROM public.dataset_rows r WHERE r.dataset_id = $1 AND (%s)', pred)
    INTO _matched USING _dataset;
  RETURN QUERY EXECUTE format($q$
    SELECT
      CASE WHEN $2 IS NULL THEN 'Gesamt' ELSE coalesce(r.data->>$2, '–') END AS bucket,
      round(CASE $3
        WHEN 'count' THEN count(*)::numeric
        WHEN 'sum' THEN coalesce(sum(private.to_num(r.data->>$4)), 0)
        WHEN 'avg' THEN coalesce(avg(private.to_num(r.data->>$4)), 0)
        WHEN 'min' THEN coalesce(min(private.to_num(r.data->>$4)), 0)
        ELSE coalesce(max(private.to_num(r.data->>$4)), 0)
      END, 3) AS value,
      count(*)::bigint AS cnt,
      $5::bigint AS matched,
      $6::bigint AS total
    FROM public.dataset_rows r
    WHERE r.dataset_id = $1 AND (%s)
    GROUP BY 1
    ORDER BY 2 DESC
    LIMIT 200
  $q$, pred) USING _dataset, _group_by, _fn, _measure, _matched, _total;
END;
$fn$;

-- Gefilterte Zeilen, immer gedeckelt und optional auf Spalten beschränkt.
CREATE OR REPLACE FUNCTION public.dataset_query_rows(
  _dataset uuid,
  _filters jsonb DEFAULT '[]'::jsonb,
  _columns text[] DEFAULT NULL,
  _limit integer DEFAULT 100,
  _offset integer DEFAULT 0
)
RETURNS TABLE(row_index integer, data jsonb, matched bigint, total bigint)
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $fn$
DECLARE
  pred text;
  _total bigint;
  _matched bigint;
  _lim integer := least(greatest(coalesce(_limit, 100), 1), 1000);
  _off integer := greatest(coalesce(_offset, 0), 0);
BEGIN
  pred := private.dataset_predicate(_filters);
  SELECT count(*) INTO _total FROM public.dataset_rows r WHERE r.dataset_id = _dataset;
  EXECUTE format(
    'SELECT count(*)::bigint FROM public.dataset_rows r WHERE r.dataset_id = $1 AND (%s)', pred)
    INTO _matched USING _dataset;
  RETURN QUERY EXECUTE format($q$
    SELECT
      r.row_index,
      CASE WHEN $2 IS NULL THEN r.data
           ELSE coalesce((SELECT jsonb_object_agg(k, v) FROM jsonb_each(r.data) AS e(k, v)
                          WHERE k = ANY($2)), '{}'::jsonb) END AS data,
      $5::bigint AS matched,
      $6::bigint AS total
    FROM public.dataset_rows r
    WHERE r.dataset_id = $1 AND (%s)
    ORDER BY r.row_index
    LIMIT $3 OFFSET $4
  $q$, pred) USING _dataset, _columns, _lim, _off, _matched, _total;
END;
$fn$;

-- Kartenausschnitt: nur die sichtbaren Punkte, über den Geo-Index.
CREATE OR REPLACE FUNCTION public.dataset_bbox(
  _dataset uuid,
  _south double precision DEFAULT NULL,
  _west double precision DEFAULT NULL,
  _north double precision DEFAULT NULL,
  _east double precision DEFAULT NULL,
  _name_col text DEFAULT NULL,
  _limit integer DEFAULT 300
)
RETURNS TABLE(row_index integer, lat double precision, lon double precision, name text, matched bigint, total bigint)
LANGUAGE sql
STABLE
SET search_path = public
AS $fn$
  WITH hits AS (
    SELECT r.row_index, r.lat, r.lon,
           CASE WHEN _name_col IS NULL THEN '' ELSE coalesce(r.data->>_name_col, '') END AS name
    FROM public.dataset_rows r
    WHERE r.dataset_id = _dataset
      AND r.lat IS NOT NULL AND r.lon IS NOT NULL
      AND (_south IS NULL OR r.lat >= _south)
      AND (_north IS NULL OR r.lat <= _north)
      AND (_west IS NULL OR r.lon >= _west)
      AND (_east IS NULL OR r.lon <= _east)
  )
  SELECT h.row_index, h.lat, h.lon, h.name,
         (SELECT count(*) FROM hits)::bigint AS matched,
         (SELECT count(*) FROM public.dataset_rows r2 WHERE r2.dataset_id = _dataset)::bigint AS total
  FROM hits h
  ORDER BY h.row_index
  LIMIT least(greatest(coalesce(_limit, 300), 1), 1000);
$fn$;

-- Spaltenregel über alle Zeilen: zurück kommen nur Zähler und wenige Zeilennummern.
CREATE OR REPLACE FUNCTION public.dataset_rule_check(
  _dataset uuid,
  _column text,
  _operator text,
  _value jsonb DEFAULT 'null'::jsonb
)
RETURNS TABLE(total bigint, passed bigint, failed bigint, failed_rows integer[])
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $fn$
DECLARE
  pred text;
  op text := CASE WHEN _operator = 'required' THEN 'filled' ELSE _operator END;
  _total bigint;
  _passed bigint;
  _rows integer[];
BEGIN
  IF op NOT IN ('eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'oneOf', 'filled') THEN
    RAISE EXCEPTION 'Nicht unterstützter Vergleich: %', _operator;
  END IF;
  pred := private.dataset_predicate(
    jsonb_build_array(jsonb_build_object('column', _column, 'op', op, 'value', _value)));
  SELECT count(*) INTO _total FROM public.dataset_rows r WHERE r.dataset_id = _dataset;
  EXECUTE format(
    'SELECT count(*)::bigint FROM public.dataset_rows r WHERE r.dataset_id = $1 AND (%s)', pred)
    INTO _passed USING _dataset;
  EXECUTE format(
    'SELECT coalesce(array_agg(x.row_index), ARRAY[]::integer[]) FROM ('
    || 'SELECT r.row_index FROM public.dataset_rows r WHERE r.dataset_id = $1 AND NOT (%s)'
    || ' ORDER BY r.row_index LIMIT 20) x', pred)
    INTO _rows USING _dataset;
  RETURN QUERY SELECT _total, _passed, _total - _passed, _rows;
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.dataset_aggregate(uuid, jsonb, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dataset_query_rows(uuid, jsonb, text[], integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dataset_bbox(uuid, double precision, double precision, double precision, double precision, text, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dataset_rule_check(uuid, text, text, jsonb) TO authenticated;

COMMENT ON COLUMN public.datasets.storage_path IS 'DEPRECATED: nur noch für Altbestände; neue Zeilen liegen in public.dataset_rows';