CREATE SCHEMA IF NOT EXISTS migration_meta;
CREATE SCHEMA IF NOT EXISTS migration_stage;
CREATE SCHEMA IF NOT EXISTS migration_work;

CREATE TABLE IF NOT EXISTS migration_meta.import_runs (
  id BIGSERIAL PRIMARY KEY,
  archive_path TEXT NOT NULL,
  archive_checksum TEXT NOT NULL,
  status TEXT NOT NULL,
  notes TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS migration_meta.import_metrics (
  id BIGSERIAL PRIMARY KEY,
  run_id BIGINT NOT NULL REFERENCES migration_meta.import_runs(id) ON DELETE CASCADE,
  metric_name TEXT NOT NULL,
  metric_value NUMERIC NOT NULL,
  details_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS migration_meta.import_audit (
  id BIGSERIAL PRIMARY KEY,
  run_id BIGINT NOT NULL REFERENCES migration_meta.import_runs(id) ON DELETE CASCADE,
  source_collection TEXT NOT NULL,
  source_key TEXT,
  action TEXT NOT NULL,
  reason TEXT NOT NULL,
  payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS import_audit_run_id_idx
  ON migration_meta.import_audit (run_id);

CREATE TABLE IF NOT EXISTS migration_stage.profiles_raw (
  id BIGSERIAL PRIMARY KEY,
  run_id BIGINT NOT NULL REFERENCES migration_meta.import_runs(id) ON DELETE CASCADE,
  source_key TEXT NOT NULL,
  payload_json JSONB NOT NULL,
  loaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (run_id, source_key)
);

CREATE TABLE IF NOT EXISTS migration_stage.adventures_raw (
  id BIGSERIAL PRIMARY KEY,
  run_id BIGINT NOT NULL REFERENCES migration_meta.import_runs(id) ON DELETE CASCADE,
  source_key TEXT NOT NULL,
  payload_json JSONB NOT NULL,
  loaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (run_id, source_key)
);

CREATE TABLE IF NOT EXISTS migration_stage.sidekicks_raw (
  id BIGSERIAL PRIMARY KEY,
  run_id BIGINT NOT NULL REFERENCES migration_meta.import_runs(id) ON DELETE CASCADE,
  source_key TEXT NOT NULL,
  payload_json JSONB NOT NULL,
  loaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (run_id, source_key)
);

CREATE TABLE IF NOT EXISTS migration_stage.favorites_raw (
  id BIGSERIAL PRIMARY KEY,
  run_id BIGINT NOT NULL REFERENCES migration_meta.import_runs(id) ON DELETE CASCADE,
  source_key TEXT NOT NULL,
  payload_json JSONB NOT NULL,
  loaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (run_id, source_key)
);

CREATE TABLE IF NOT EXISTS migration_stage.comments_raw (
  id BIGSERIAL PRIMARY KEY,
  run_id BIGINT NOT NULL REFERENCES migration_meta.import_runs(id) ON DELETE CASCADE,
  source_key TEXT NOT NULL,
  payload_json JSONB NOT NULL,
  loaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (run_id, source_key)
);

CREATE TABLE IF NOT EXISTS migration_work.users_work (
  run_id BIGINT NOT NULL REFERENCES migration_meta.import_runs(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  source_username TEXT NOT NULL,
  handle TEXT NOT NULL,
  email TEXT,
  cognito_subject TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  linked_at TIMESTAMPTZ,
  link_source TEXT,
  PRIMARY KEY (run_id, user_id),
  UNIQUE (run_id, handle)
);

CREATE INDEX IF NOT EXISTS users_work_run_id_email_idx
  ON migration_work.users_work (run_id, email);

CREATE TABLE IF NOT EXISTS migration_work.profiles_work (
  run_id BIGINT NOT NULL,
  user_id UUID NOT NULL,
  display_name TEXT,
  home_city TEXT,
  home_region TEXT,
  avatar_storage_key TEXT,
  cover_storage_key TEXT,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (run_id, user_id),
  FOREIGN KEY (run_id, user_id)
    REFERENCES migration_work.users_work(run_id, user_id)
    ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS migration_work.media_assets_work (
  run_id BIGINT NOT NULL REFERENCES migration_meta.import_runs(id) ON DELETE CASCADE,
  media_asset_id UUID NOT NULL,
  owner_user_id UUID NOT NULL,
  storage_key TEXT NOT NULL,
  kind TEXT NOT NULL,
  moderation_status TEXT NOT NULL DEFAULT 'approved',
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (run_id, media_asset_id),
  UNIQUE (run_id, storage_key)
);

CREATE TABLE IF NOT EXISTS migration_work.adventures_work (
  run_id BIGINT NOT NULL REFERENCES migration_meta.import_runs(id) ON DELETE CASCADE,
  adventure_id UUID NOT NULL,
  legacy_adventure_id TEXT NOT NULL,
  author_user_id UUID NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  category_slug TEXT,
  visibility TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'published',
  longitude DOUBLE PRECISION,
  latitude DOUBLE PRECISION,
  default_image_key TEXT,
  legacy_rating_sum DOUBLE PRECISION NOT NULL DEFAULT 0,
  legacy_rating_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  published_at TIMESTAMPTZ,
  PRIMARY KEY (run_id, adventure_id),
  UNIQUE (run_id, legacy_adventure_id)
);

CREATE TABLE IF NOT EXISTS migration_work.connections_work (
  run_id BIGINT NOT NULL REFERENCES migration_meta.import_runs(id) ON DELETE CASCADE,
  connection_id UUID NOT NULL,
  user_id_low UUID NOT NULL,
  user_id_high UUID NOT NULL,
  initiated_by_user_id UUID NOT NULL,
  status TEXT NOT NULL,
  requested_at TIMESTAMPTZ NOT NULL,
  responded_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL,
  source_username TEXT NOT NULL,
  source_sidekick_name TEXT NOT NULL,
  PRIMARY KEY (run_id, connection_id),
  UNIQUE (run_id, user_id_low, user_id_high)
);

CREATE TABLE IF NOT EXISTS migration_work.adventure_favorites_work (
  run_id BIGINT NOT NULL REFERENCES migration_meta.import_runs(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  adventure_id UUID NOT NULL,
  source_username TEXT NOT NULL,
  source_adventure_id TEXT NOT NULL,
  created_at TIMESTAMPTZ,
  PRIMARY KEY (run_id, user_id, adventure_id)
);

CREATE TABLE IF NOT EXISTS migration_work.adventure_comments_work (
  run_id BIGINT NOT NULL REFERENCES migration_meta.import_runs(id) ON DELETE CASCADE,
  comment_id UUID NOT NULL,
  adventure_id UUID NOT NULL,
  author_user_id UUID NOT NULL,
  source_comment_id TEXT,
  source_username TEXT NOT NULL,
  source_adventure_id TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (run_id, comment_id)
);

CREATE TABLE IF NOT EXISTS migration_work.adventure_rating_projection_work (
  run_id BIGINT NOT NULL REFERENCES migration_meta.import_runs(id) ON DELETE CASCADE,
  adventure_id UUID NOT NULL,
  legacy_adventure_id TEXT NOT NULL,
  legacy_rating_sum DOUBLE PRECISION NOT NULL DEFAULT 0,
  legacy_rating_count INTEGER NOT NULL DEFAULT 0,
  average_rating DOUBLE PRECISION NOT NULL DEFAULT 0,
  PRIMARY KEY (run_id, adventure_id),
  UNIQUE (run_id, legacy_adventure_id)
);

CREATE TABLE IF NOT EXISTS migration_work.import_maps (
  run_id BIGINT NOT NULL REFERENCES migration_meta.import_runs(id) ON DELETE CASCADE,
  map_type TEXT NOT NULL,
  legacy_key TEXT NOT NULL,
  new_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (run_id, map_type, legacy_key),
  UNIQUE (run_id, map_type, new_id)
);
