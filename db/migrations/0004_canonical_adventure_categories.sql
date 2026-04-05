UPDATE public.adventures
SET category_slug = CASE category_slug
  WHEN 'Viewpoint' THEN 'viewpoints'
  WHEN 'viewpoint' THEN 'viewpoints'
  WHEN 'viewpoints' THEN 'viewpoints'
  WHEN 'Trail' THEN 'trails'
  WHEN 'trail' THEN 'trails'
  WHEN 'trails' THEN 'trails'
  WHEN 'Beach_Cove' THEN 'water_spots'
  WHEN 'Creek_Rivers' THEN 'water_spots'
  WHEN 'SwimmingHole' THEN 'water_spots'
  WHEN 'RopeSwing' THEN 'water_spots'
  WHEN 'Fishing' THEN 'water_spots'
  WHEN 'beach-cove' THEN 'water_spots'
  WHEN 'creek-river' THEN 'water_spots'
  WHEN 'swimming-hole' THEN 'water_spots'
  WHEN 'rope-swing' THEN 'water_spots'
  WHEN 'fishing' THEN 'water_spots'
  WHEN 'water_spots' THEN 'water_spots'
  WHEN 'Restaurant' THEN 'food_drink'
  WHEN 'Cafe' THEN 'food_drink'
  WHEN 'Bar' THEN 'food_drink'
  WHEN 'LiveMusic' THEN 'food_drink'
  WHEN 'restaurant' THEN 'food_drink'
  WHEN 'cafe' THEN 'food_drink'
  WHEN 'bar' THEN 'food_drink'
  WHEN 'live-music' THEN 'food_drink'
  WHEN 'food_drink' THEN 'food_drink'
  WHEN 'Abandoned' THEN 'abandoned_places'
  WHEN 'abandoned' THEN 'abandoned_places'
  WHEN 'abandoned_places' THEN 'abandoned_places'
  WHEN 'Cave' THEN 'caves'
  WHEN 'cave' THEN 'caves'
  WHEN 'caves' THEN 'caves'
  WHEN 'Forest' THEN 'nature_escapes'
  WHEN 'Desert' THEN 'nature_escapes'
  WHEN 'forest' THEN 'nature_escapes'
  WHEN 'desert' THEN 'nature_escapes'
  WHEN 'nature_escapes' THEN 'nature_escapes'
  WHEN 'road' THEN 'roadside_stops'
  WHEN 'Bridge' THEN 'roadside_stops'
  WHEN 'roadside-stop' THEN 'roadside_stops'
  WHEN 'bridge' THEN 'roadside_stops'
  WHEN 'roadside_stops' THEN 'roadside_stops'
  ELSE category_slug
END
WHERE category_slug IS NOT NULL;

UPDATE migration_work.adventures_work
SET category_slug = CASE category_slug
  WHEN 'Viewpoint' THEN 'viewpoints'
  WHEN 'viewpoint' THEN 'viewpoints'
  WHEN 'viewpoints' THEN 'viewpoints'
  WHEN 'Trail' THEN 'trails'
  WHEN 'trail' THEN 'trails'
  WHEN 'trails' THEN 'trails'
  WHEN 'Beach_Cove' THEN 'water_spots'
  WHEN 'Creek_Rivers' THEN 'water_spots'
  WHEN 'SwimmingHole' THEN 'water_spots'
  WHEN 'RopeSwing' THEN 'water_spots'
  WHEN 'Fishing' THEN 'water_spots'
  WHEN 'beach-cove' THEN 'water_spots'
  WHEN 'creek-river' THEN 'water_spots'
  WHEN 'swimming-hole' THEN 'water_spots'
  WHEN 'rope-swing' THEN 'water_spots'
  WHEN 'fishing' THEN 'water_spots'
  WHEN 'water_spots' THEN 'water_spots'
  WHEN 'Restaurant' THEN 'food_drink'
  WHEN 'Cafe' THEN 'food_drink'
  WHEN 'Bar' THEN 'food_drink'
  WHEN 'LiveMusic' THEN 'food_drink'
  WHEN 'restaurant' THEN 'food_drink'
  WHEN 'cafe' THEN 'food_drink'
  WHEN 'bar' THEN 'food_drink'
  WHEN 'live-music' THEN 'food_drink'
  WHEN 'food_drink' THEN 'food_drink'
  WHEN 'Abandoned' THEN 'abandoned_places'
  WHEN 'abandoned' THEN 'abandoned_places'
  WHEN 'abandoned_places' THEN 'abandoned_places'
  WHEN 'Cave' THEN 'caves'
  WHEN 'cave' THEN 'caves'
  WHEN 'caves' THEN 'caves'
  WHEN 'Forest' THEN 'nature_escapes'
  WHEN 'Desert' THEN 'nature_escapes'
  WHEN 'forest' THEN 'nature_escapes'
  WHEN 'desert' THEN 'nature_escapes'
  WHEN 'nature_escapes' THEN 'nature_escapes'
  WHEN 'road' THEN 'roadside_stops'
  WHEN 'Bridge' THEN 'roadside_stops'
  WHEN 'roadside-stop' THEN 'roadside_stops'
  WHEN 'bridge' THEN 'roadside_stops'
  WHEN 'roadside_stops' THEN 'roadside_stops'
  ELSE category_slug
END
WHERE category_slug IS NOT NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.adventures
    WHERE category_slug IS NOT NULL
      AND category_slug NOT IN (
        'viewpoints',
        'trails',
        'water_spots',
        'food_drink',
        'abandoned_places',
        'caves',
        'nature_escapes',
        'roadside_stops'
      )
  ) THEN
    RAISE EXCEPTION 'public.adventures contains non-canonical category slugs after backfill';
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM migration_work.adventures_work
    WHERE category_slug IS NOT NULL
      AND category_slug NOT IN (
        'viewpoints',
        'trails',
        'water_spots',
        'food_drink',
        'abandoned_places',
        'caves',
        'nature_escapes',
        'roadside_stops'
      )
  ) THEN
    RAISE EXCEPTION 'migration_work.adventures_work contains non-canonical category slugs after backfill';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'adventures_category_slug_check'
  ) THEN
    ALTER TABLE public.adventures
      ADD CONSTRAINT adventures_category_slug_check
      CHECK (
        category_slug IS NULL OR category_slug IN (
          'viewpoints',
          'trails',
          'water_spots',
          'food_drink',
          'abandoned_places',
          'caves',
          'nature_escapes',
          'roadside_stops'
        )
      );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'adventures_work_category_slug_check'
  ) THEN
    ALTER TABLE migration_work.adventures_work
      ADD CONSTRAINT adventures_work_category_slug_check
      CHECK (
        category_slug IS NULL OR category_slug IN (
          'viewpoints',
          'trails',
          'water_spots',
          'food_drink',
          'abandoned_places',
          'caves',
          'nature_escapes',
          'roadside_stops'
        )
      );
  END IF;
END $$;
