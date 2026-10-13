-- Run on a clone after its database is restored from another server's backup.
-- Databases from before Tamanu shipped forget_server_identity() get the same
-- removal inline.
DO $$
BEGIN
  IF to_regprocedure('public.forget_server_identity()') IS NOT NULL THEN
    -- The function refuses unless the transaction declares the database a copy.
    PERFORM set_config('tamanu.this_is_a_copy', 'true', true);
    PERFORM public.forget_server_identity();
    RETURN;
  END IF;

  IF to_regclass('public.local_system_secrets') IS NOT NULL THEN
    DELETE FROM public.local_system_secrets;
  END IF;
  DELETE FROM public.local_system_facts
  WHERE key IN ('syncHost', 'syncEmail', 'facilityIds', 'deviceId', 'metaServerId')
     OR value ~ '^S1:[^:]*:[^:]*$';
  UPDATE public.settings SET deleted_at = now()
  WHERE deleted_at IS NULL
    AND jsonb_typeof(value) = 'string'
    AND value #>> '{}' ~ '^S1:[^:]*:[^:]*$';
END
$$;
