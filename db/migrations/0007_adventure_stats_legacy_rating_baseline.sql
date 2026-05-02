ALTER TABLE public.adventure_stats
ADD COLUMN IF NOT EXISTS legacy_rating_count INTEGER NOT NULL DEFAULT 0;

ALTER TABLE public.adventure_stats
ADD COLUMN IF NOT EXISTS legacy_rating_sum DOUBLE PRECISION NOT NULL DEFAULT 0;

UPDATE public.adventure_stats
SET
  legacy_rating_count = rating_count,
  legacy_rating_sum = rating_sum
WHERE legacy_rating_count = 0
  AND legacy_rating_sum = 0
  AND rating_count > 0;
