DO $$
BEGIN
  CREATE TYPE public.connection_status AS ENUM ('pending', 'accepted', 'blocked');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE public.adventure_visibility AS ENUM ('private', 'connections', 'public');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE public.adventure_status AS ENUM ('draft', 'published', 'archived');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE public.media_moderation_status AS ENUM ('pending', 'approved', 'rejected');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS public.users (
  id UUID PRIMARY KEY,
  cognito_subject TEXT UNIQUE,
  handle TEXT NOT NULL UNIQUE,
  email TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  deleted_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS public.media_assets (
  id UUID PRIMARY KEY,
  owner_user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  storage_key TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL,
  mime_type TEXT,
  byte_size INTEGER,
  width INTEGER,
  height INTEGER,
  moderation_status public.media_moderation_status NOT NULL DEFAULT 'pending',
  moderation_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  deleted_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS public.profiles (
  user_id UUID PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  display_name TEXT,
  bio TEXT,
  home_city TEXT,
  home_region TEXT,
  avatar_media_asset_id UUID REFERENCES public.media_assets(id),
  cover_media_asset_id UUID REFERENCES public.media_assets(id),
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS public.connections (
  id UUID PRIMARY KEY,
  user_id_low UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  user_id_high UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  initiated_by_user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  status public.connection_status NOT NULL,
  requested_at TIMESTAMPTZ NOT NULL,
  responded_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT connections_unique_pair UNIQUE (user_id_low, user_id_high),
  CONSTRAINT connections_order_check CHECK (user_id_low < user_id_high),
  CONSTRAINT connections_initiator_check CHECK (
    initiated_by_user_id = user_id_low OR initiated_by_user_id = user_id_high
  )
);

CREATE TABLE IF NOT EXISTS public.adventures (
  id UUID PRIMARY KEY,
  author_user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  category_slug TEXT,
  visibility public.adventure_visibility NOT NULL DEFAULT 'private',
  status public.adventure_status NOT NULL DEFAULT 'published',
  location geography(Point, 4326),
  place_label TEXT,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  published_at TIMESTAMPTZ,
  archived_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS public.adventure_media (
  adventure_id UUID NOT NULL REFERENCES public.adventures(id) ON DELETE CASCADE,
  media_asset_id UUID NOT NULL REFERENCES public.media_assets(id) ON DELETE CASCADE,
  sort_order INTEGER NOT NULL,
  is_primary BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (adventure_id, media_asset_id),
  CONSTRAINT adventure_media_sort_order_unique UNIQUE (adventure_id, sort_order)
);

CREATE UNIQUE INDEX IF NOT EXISTS adventure_media_primary_idx
  ON public.adventure_media (adventure_id)
  WHERE is_primary = TRUE;

CREATE TABLE IF NOT EXISTS public.adventure_favorites (
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  adventure_id UUID NOT NULL REFERENCES public.adventures(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (user_id, adventure_id)
);

CREATE TABLE IF NOT EXISTS public.adventure_comments (
  id UUID PRIMARY KEY,
  adventure_id UUID NOT NULL REFERENCES public.adventures(id) ON DELETE CASCADE,
  author_user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  deleted_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS public.adventure_ratings (
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  adventure_id UUID NOT NULL REFERENCES public.adventures(id) ON DELETE CASCADE,
  score SMALLINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (user_id, adventure_id),
  CONSTRAINT adventure_ratings_score_check CHECK (score BETWEEN 1 AND 5)
);

CREATE TABLE IF NOT EXISTS public.adventure_stats (
  adventure_id UUID PRIMARY KEY REFERENCES public.adventures(id) ON DELETE CASCADE,
  favorite_count INTEGER NOT NULL DEFAULT 0,
  comment_count INTEGER NOT NULL DEFAULT 0,
  rating_count INTEGER NOT NULL DEFAULT 0,
  rating_sum DOUBLE PRECISION NOT NULL DEFAULT 0,
  average_rating DOUBLE PRECISION NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL
);
