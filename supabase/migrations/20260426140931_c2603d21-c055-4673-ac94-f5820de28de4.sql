CREATE OR REPLACE FUNCTION public.__exec_sql_raw(p_sql text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  EXECUTE p_sql;
END;
$$;

REVOKE ALL ON FUNCTION public.__exec_sql_raw(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.__exec_sql_raw(text) TO service_role;