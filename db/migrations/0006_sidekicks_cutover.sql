DO $$
BEGIN
  CREATE TABLE IF NOT EXISTS migration_work.sidekick_grants_work (
    run_id BIGINT NOT NULL REFERENCES migration_meta.import_runs(id) ON DELETE CASCADE,
    sidekick_grant_id UUID NOT NULL,
    grantor_user_id UUID NOT NULL,
    grantee_user_id UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    source_username TEXT NOT NULL,
    source_sidekick_name TEXT NOT NULL,
    PRIMARY KEY (run_id, sidekick_grant_id),
    UNIQUE (run_id, grantor_user_id, grantee_user_id),
    CONSTRAINT migration_work_sidekick_grants_direction_check CHECK (grantor_user_id <> grantee_user_id)
  );
END $$;

INSERT INTO migration_work.sidekick_grants_work (
  run_id,
  sidekick_grant_id,
  grantor_user_id,
  grantee_user_id,
  created_at,
  updated_at,
  source_username,
  source_sidekick_name
)
SELECT
  run_id,
  connection_id,
  initiated_by_user_id,
  CASE
    WHEN initiated_by_user_id = user_id_low THEN user_id_high
    ELSE user_id_low
  END,
  requested_at,
  updated_at,
  source_username,
  source_sidekick_name
FROM migration_work.connections_work
ON CONFLICT (run_id, sidekick_grant_id) DO NOTHING;

DROP TABLE IF EXISTS migration_work.connections_work;

DO $$
BEGIN
  CREATE TABLE IF NOT EXISTS public.sidekick_grants (
    id UUID PRIMARY KEY,
    grantor_user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    grantee_user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    CONSTRAINT sidekick_grants_unique_pair UNIQUE (grantor_user_id, grantee_user_id),
    CONSTRAINT sidekick_grants_direction_check CHECK (grantor_user_id <> grantee_user_id)
  );
END $$;

INSERT INTO public.sidekick_grants (
  id,
  grantor_user_id,
  grantee_user_id,
  created_at,
  updated_at
)
SELECT
  id,
  initiated_by_user_id,
  CASE
    WHEN initiated_by_user_id = user_id_low THEN user_id_high
    ELSE user_id_low
  END,
  requested_at,
  updated_at
FROM public.connections
ON CONFLICT (grantor_user_id, grantee_user_id) DO NOTHING;

ALTER TABLE public.adventures
  ALTER COLUMN visibility TYPE TEXT;

UPDATE public.adventures
SET visibility = 'sidekicks'
WHERE visibility = 'connections';

ALTER TYPE public.adventure_visibility RENAME TO adventure_visibility_old;

CREATE TYPE public.adventure_visibility AS ENUM ('private', 'sidekicks', 'public');

ALTER TABLE public.adventures
  ALTER COLUMN visibility TYPE public.adventure_visibility
  USING visibility::text::public.adventure_visibility;

DROP TYPE public.adventure_visibility_old;

DROP TABLE IF EXISTS public.connections;
DROP TYPE IF EXISTS public.connection_status;
