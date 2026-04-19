import { randomUUID } from "node:crypto";

import type { PoolClient, QueryResultRow } from "pg";

import { db } from "../../db/client.js";
import { toApiAdventureVisibility } from "./visibility.js";

type AdventureFeedRow = QueryResultRow & {
  id: string;
  title: string;
  description: string | null;
  category_slug: string | null;
  visibility: string;
  created_at: string;
  published_at: string | null;
  latitude: number | null;
  longitude: number | null;
  author_handle: string;
  author_display_name: string | null;
  author_home_city: string | null;
  author_home_region: string | null;
  primary_media_id: string | null;
  primary_media_storage_key: string | null;
  favorite_count: number | null;
  comment_count: number | null;
  rating_count: number | null;
  average_rating: number | null;
  place_label: string | null;
  distance_miles: number | null;
};

export type AdventureCard = {
  id: string;
  title: string;
  description: string | null;
  categorySlug: string | null;
  visibility: string;
  createdAt: string;
  publishedAt: string | null;
  location: {
    latitude: number;
    longitude: number;
  } | null;
  placeLabel: string | null;
  author: {
    handle: string;
    displayName: string | null;
    homeCity: string | null;
    homeRegion: string | null;
  };
  primaryMedia: {
    id: string;
    storageKey: string;
  } | null;
  stats: {
    favoriteCount: number;
    commentCount: number;
    ratingCount: number;
    averageRating: number;
  };
  distanceMiles?: number;
};

export type FeedScope = {
  center: {
    latitude: number;
    longitude: number;
  };
  radiusMiles: number;
};

export type FeedListResult = {
  items: AdventureCard[];
  scope?: FeedScope;
};

type AdventureDetailRow = AdventureFeedRow & {
  place_label: string | null;
  updated_at: string;
};

type AdventureMediaRow = QueryResultRow & {
  media_id: string;
  sort_order: number;
  is_primary: boolean;
  width: number | null;
  height: number | null;
};

export type AdventureMediaItem = {
  id: string;
  sortOrder: number;
  isPrimary: boolean;
  width: number | null;
  height: number | null;
};

export type AdventureCreateMediaInput = {
  mediaId: string;
  sortOrder: number;
  isPrimary: boolean;
};

export type AdventureCreateInput = {
  authorUserId: string;
  title: string;
  description: string | null;
  categorySlug: string | null;
  visibility: string;
  location: {
    latitude: number;
    longitude: number;
  } | null;
  placeLabel: string | null;
  media: AdventureCreateMediaInput[];
  status?: "pending_moderation" | "published";
};

export type CreatedAdventure = {
  id: string;
  status: string;
};

function mapAdventureCard(row: AdventureFeedRow): AdventureCard {
  const distanceMiles = row.distance_miles;

  return {
    id: row.id,
    title: row.title,
    description: row.description,
    categorySlug: row.category_slug,
    visibility: toApiAdventureVisibility(row.visibility),
    createdAt: row.created_at,
    publishedAt: row.published_at,
    location:
      row.latitude !== null && row.longitude !== null
        ? {
            latitude: row.latitude,
            longitude: row.longitude
          }
        : null,
    placeLabel: row.place_label,
    author: {
      handle: row.author_handle,
      displayName: row.author_display_name,
      homeCity: row.author_home_city,
      homeRegion: row.author_home_region
    },
    primaryMedia:
      row.primary_media_id && row.primary_media_storage_key
        ? {
            id: row.primary_media_id,
            storageKey: row.primary_media_storage_key
          }
        : null,
    stats: {
      favoriteCount: row.favorite_count ?? 0,
      commentCount: row.comment_count ?? 0,
      ratingCount: row.rating_count ?? 0,
      averageRating: row.average_rating ?? 0
    },
    ...(distanceMiles !== null && distanceMiles !== undefined ? { distanceMiles } : {})
  };
}

export function visibilityClause(): string {
  return `
    (
      adventures.visibility = 'public'
      or exists (
        select 1
        from viewer
        where viewer.id = adventures.author_user_id
      )
      or (
        adventures.visibility = 'sidekicks'
        and exists (
          select 1
          from viewer
          join public.sidekick_grants
            on public.sidekick_grants.grantor_user_id = adventures.author_user_id
           and public.sidekick_grants.grantee_user_id = viewer.id
        )
      )
    )
  `;
}

const adventureBaseSelect = `
  select
    adventures.id::text as id,
    adventures.title,
    adventures.description,
    adventures.category_slug,
    adventures.visibility::text as visibility,
    adventures.created_at::text as created_at,
    adventures.published_at::text as published_at,
    st_y(adventures.location::geometry) as latitude,
    st_x(adventures.location::geometry) as longitude,
    users.handle as author_handle,
    profiles.display_name as author_display_name,
    profiles.home_city as author_home_city,
    profiles.home_region as author_home_region,
    media_assets.id::text as primary_media_id,
    media_assets.storage_key as primary_media_storage_key,
    adventure_stats.favorite_count,
    adventure_stats.comment_count,
    adventure_stats.rating_count,
    adventure_stats.average_rating,
    adventures.place_label
`;

const feedGeoSelect = `
  ,
  case
    when scope.center_point is null or adventures.location is null then null
    else round(((st_distance(adventures.location, scope.center_point) / 1609.344)::numeric), 1)::double precision
  end as distance_miles
`;

const feedJoins = `
  from public.adventures adventures
  join public.users users
    on users.id = adventures.author_user_id
  left join public.profiles profiles
    on profiles.user_id = users.id
  left join public.adventure_media adventure_media
    on adventure_media.adventure_id = adventures.id
   and adventure_media.is_primary = true
  left join public.media_assets media_assets
    on media_assets.id = adventure_media.media_asset_id
  left join public.adventure_stats adventure_stats
    on adventure_stats.adventure_id = adventures.id
`;

export async function listFeed(options: {
  viewerId?: string;
  limit: number;
  offset: number;
  latitude?: number;
  longitude?: number;
  radiusMiles?: number;
  sort?: "recent" | "distance";
}): Promise<FeedListResult> {
  const hasGeoScope = options.latitude !== undefined && options.longitude !== undefined;
  const radiusMiles = hasGeoScope ? (options.radiusMiles ?? 25) : undefined;
  const orderBy = hasGeoScope && options.sort === "distance"
    ? "distance_miles asc nulls last, adventures.id desc"
    : "coalesce(adventures.published_at, adventures.created_at) desc, adventures.id desc";

  const result = await db.query<AdventureFeedRow>(
    `
      with viewer as (
        select $1::uuid as id
      ),
      scope as (
        select
          case
            when $4::double precision is null or $5::double precision is null then null
            else st_setsrid(st_makepoint($5::double precision, $4::double precision), 4326)::geography
          end as center_point,
          ($6::double precision * 1609.344) as radius_meters
      )
      ${adventureBaseSelect}
      ${feedGeoSelect}
      ${feedJoins}
      cross join scope
      where adventures.status = 'published'
        and ${visibilityClause()}
        and (
          scope.center_point is null
          or (
            adventures.location is not null
            and st_dwithin(adventures.location, scope.center_point, scope.radius_meters)
          )
        )
      order by ${orderBy}
      limit $2
      offset $3
    `,
    [
      options.viewerId ?? null,
      options.limit,
      options.offset,
      hasGeoScope ? options.latitude ?? null : null,
      hasGeoScope ? options.longitude ?? null : null,
      radiusMiles ?? null
    ]
  );

  return {
    items: result.rows.map(mapAdventureCard),
    ...(hasGeoScope && radiusMiles !== undefined
      ? {
          scope: {
            center: {
              latitude: options.latitude!,
              longitude: options.longitude!
            },
            radiusMiles
          }
        }
      : {})
  };
}

export async function getAdventureById(options: {
  adventureId: string;
  viewerId?: string;
}): Promise<(AdventureCard & { placeLabel: string | null; updatedAt: string }) | null> {
  const result = await db.query<AdventureDetailRow>(
    `
      with viewer as (
        select $1::uuid as id
      )
      ${adventureBaseSelect},
      adventures.updated_at::text as updated_at
      ${feedJoins}
      where adventures.id = $2::uuid
        and adventures.status = 'published'
        and ${visibilityClause()}
      limit 1
    `,
    [options.viewerId ?? null, options.adventureId]
  );

  const row = result.rows[0];
  if (!row) {
    return null;
  }

  return {
    ...mapAdventureCard(row),
    placeLabel: row.place_label,
    updatedAt: row.updated_at
  };
}

export async function listAdventureMedia(options: {
  adventureId: string;
  viewerId?: string;
}): Promise<AdventureMediaItem[] | null> {
  const visibleAdventure = await db.query<QueryResultRow>(
    `
      with viewer as (
        select $1::uuid as id
      )
      select adventures.id
      from public.adventures adventures
      where adventures.id = $2::uuid
        and adventures.status = 'published'
        and ${visibilityClause()}
      limit 1
    `,
    [options.viewerId ?? null, options.adventureId]
  );

  if (visibleAdventure.rows.length === 0) {
    return null;
  }

  const result = await db.query<AdventureMediaRow>(
    `
      select
        media_assets.id::text as media_id,
        adventure_media.sort_order,
        adventure_media.is_primary,
        media_assets.width,
        media_assets.height
      from public.adventure_media adventure_media
      join public.media_assets media_assets
        on media_assets.id = adventure_media.media_asset_id
      where adventure_media.adventure_id = $1::uuid
        and media_assets.deleted_at is null
      order by adventure_media.sort_order asc, media_assets.id asc
    `,
    [options.adventureId]
  );

  return result.rows.map((row) => ({
    id: row.media_id,
    sortOrder: row.sort_order,
    isPrimary: row.is_primary,
    width: row.width,
    height: row.height
  }));
}

export async function createAdventure(
  input: AdventureCreateInput,
  client: PoolClient
): Promise<CreatedAdventure> {
  const adventureId = randomUUID();
  const adventureStatus = input.status ?? "pending_moderation";

  const adventureResult = await client.query<QueryResultRow & { id: string; status: string }>(
    `
      insert into public.adventures (
        id,
        author_user_id,
        title,
        description,
        category_slug,
        visibility,
        status,
        location,
        place_label,
        created_at,
        updated_at,
        published_at,
        archived_at
      ) values (
        $1::uuid,
        $2::uuid,
        $3,
        $4,
        $5,
        $6::public.adventure_visibility,
        $7::public.adventure_status,
        case
          when $8::double precision is null or $9::double precision is null then null
          else st_setsrid(st_makepoint($8::double precision, $9::double precision), 4326)::geography
        end,
        $10,
        now(),
        now(),
        case when $7::public.adventure_status = 'published' then now() else null end,
        null
      )
      returning
        id::text as id,
        status::text as status
    `,
    [
      adventureId,
      input.authorUserId,
      input.title,
      input.description,
      input.categorySlug,
      input.visibility,
      adventureStatus,
      input.location?.longitude ?? null,
      input.location?.latitude ?? null,
      input.placeLabel
    ]
  );

  for (const item of input.media) {
    await client.query(
      `
        insert into public.adventure_media (
          adventure_id,
          media_asset_id,
          sort_order,
          is_primary,
          created_at
        ) values (
          $1::uuid,
          $2::uuid,
          $3,
          $4,
          now()
        )
      `,
      [adventureId, item.mediaId, item.sortOrder, item.isPrimary]
    );
  }

  return {
    id: adventureResult.rows[0]!.id,
    status: adventureResult.rows[0]!.status
  };
}
