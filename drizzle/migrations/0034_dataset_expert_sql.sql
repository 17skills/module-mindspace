-- Expert mode: read-only, sandboxed SQL over one dataset.
-- Security: SECURITY INVOKER (RLS of the caller applies), STABLE (Postgres
-- rejects any DML inside), search_path pinned to pg_catalog (unqualified
-- table names cannot resolve to application tables), keyword/substring
-- validation, 3s statement timeout and a hard 500 row cap.
CREATE OR REPLACE FUNCTION public.dataset_sql(_dataset uuid, _sql text)
 RETURNS TABLE(row_json jsonb)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  cleaned text := btrim(coalesce(_sql, ''));
  lowered text;
  cols text;
  bad text;
BEGIN
  IF cleaned = '' THEN
    RAISE EXCEPTION 'Bitte eine SELECT-Abfrage eingeben.';
  END IF;

  cleaned := btrim(regexp_replace(cleaned, ';\s*$', ''));
  IF position(';' in cleaned) > 0 THEN
    RAISE EXCEPTION 'Mehrere Anweisungen sind nicht erlaubt.';
  END IF;

  lowered := lower(cleaned);
  IF lowered !~ '^(select|with)[\s(]' THEN
    RAISE EXCEPTION 'Nur Leseabfragen (SELECT) sind erlaubt.';
  END IF;

  FOREACH bad IN ARRAY ARRAY[
    'insert','update','delete','drop','alter','create','truncate','grant','revoke',
    'copy','merge','call','do','vacuum','comment','listen','notify','reset',
    'begin','commit','rollback','lock','refresh','prepare','declare','move',
    'execute','set','setof','into'
  ] LOOP
    IF lowered ~ ('(^|[^a-z0-9_])' || bad || '([^a-z0-9_]|$)') THEN
      RAISE EXCEPTION 'Nicht erlaubtes Schlüsselwort: %', bad;
    END IF;
  END LOOP;

  FOREACH bad IN ARRAY ARRAY[
    'pg_catalog','pg_class','pg_shadow','pg_authid','pg_user','pg_sleep','pg_read',
    'pg_ls','pg_stat','pg_settings','information_schema','current_setting',
    'set_config','lo_import','lo_export','dblink','pg_file','pg_logdir',
    'auth.','storage.','vault.','private.','public.','extensions.','graphql.','realtime.',
    '--','/*'
  ] LOOP
    IF position(bad in lowered) > 0 THEN
      RAISE EXCEPTION 'Nicht erlaubter Ausdruck: %', bad;
    END IF;
  END LOOP;

  -- Typed column list from the dataset schema; RLS on datasets decides access.
  SELECT string_agg(
           CASE WHEN c->>'type' = 'number'
                THEN format('private.to_num(r.data->>%L) AS %I', c->>'key', c->>'key')
                ELSE format('(r.data->>%L) AS %I', c->>'key', c->>'key') END,
           ', ' ORDER BY ord)
    INTO cols
    FROM public.datasets d,
         jsonb_array_elements(d.schema) WITH ORDINALITY AS t(c, ord)
   WHERE d.id = _dataset
     AND coalesce(c->>'key', '') <> '';

  IF cols IS NULL THEN
    RAISE EXCEPTION 'Datenquelle nicht gefunden oder kein Zugriff.';
  END IF;

  PERFORM set_config('statement_timeout', '3000', true);

  RETURN QUERY EXECUTE format(
    'WITH data AS (SELECT r.row_index AS row_index, r.lat AS lat, r.lon AS lon, %s'
    || ' FROM public.dataset_rows r WHERE r.dataset_id = %L),'
    || ' this AS (SELECT * FROM data)'
    || ' SELECT pg_catalog.to_jsonb(q) FROM (%s) q LIMIT 500',
    cols, _dataset, cleaned);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.dataset_sql(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dataset_sql(uuid, text) TO service_role;

-- Visual builder: sorting and Top N are now chosen by the user.
CREATE OR REPLACE FUNCTION public.dataset_aggregate(_dataset uuid, _filters jsonb DEFAULT '[]'::jsonb, _group_by text DEFAULT NULL::text, _measure text DEFAULT NULL::text, _fn text DEFAULT 'count'::text, _sort text DEFAULT 'desc'::text, _limit integer DEFAULT 200)
 RETURNS TABLE(bucket text, value numeric, cnt bigint, matched bigint, total bigint)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  pred text;
  _total bigint;
  _matched bigint;
  _order text;
  _lim integer := least(greatest(coalesce(_limit, 200), 1), 200);
BEGIN
  IF _fn NOT IN ('count', 'sum', 'avg', 'min', 'max') THEN
    RAISE EXCEPTION 'Nicht unterstützte Berechnung: %', _fn;
  END IF;
  _order := CASE coalesce(_sort, 'desc')
              WHEN 'asc' THEN '2 ASC'
              WHEN 'label' THEN '1 ASC'
              ELSE '2 DESC' END;
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
    ORDER BY %s
    LIMIT %s
  $q$, pred, _order, _lim) USING _dataset, _group_by, _fn, _measure, _matched, _total;
END;
$function$;