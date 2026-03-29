ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS account_origin TEXT NOT NULL DEFAULT 'legacy_profile_import';

DO $$
BEGIN
  ALTER TABLE public.users
    ADD CONSTRAINT users_account_origin_check
    CHECK (account_origin IN ('legacy_profile_import', 'rebuild_signup'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
