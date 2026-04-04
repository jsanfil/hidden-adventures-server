import type { QueryResultRow } from "pg";

import { db } from "../../db/client.js";

type AdventureFeedRow = QueryResultRow & {
  id: string;
  title: string;
  summary: string | null;
  body: string | null;
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
};

export type AdventureCard = {
  id: string;
  title: string;
  summary: string | null;
  body: string | null;
  categorySlug: string | null;
  visibility: string;
  createdAt: string;
  publishedAt: string | null;
  location: {
    latitude: number;
    longitude: number;
  } | null;
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

type MediaDeliveryRow = QueryResultRow & {
  media_id: string;
  storage_key: string;
  mime_type: string | null;
  byte_size: number | null;
  width: number | null;
  height: number | null;
  updated_at: string;
};

export type AdventureMediaItem = {
  id: string;
  sortOrder: number;
  isPrimary: boolean;
  width: number | null;
  height: number | null;
};

export type MediaDeliveryTarget = {
  id: string;
  storageKey: string;
  mimeType: string | null;
  byteSize: number | null;
  width: number | null;
  height: number | null;
  updatedAt: string;
};

function mapAdventureCard(row: AdventureFeedRow): AdventureCard {
  return {
    id: row.id,
    title: row.title,
    summary: row.summary,
    body: row.body,
    categorySlug: row.category_slug,
    visibility: row.visibility,
    createdAt: row.created_at,
    publishedAt: row.published_at,
    location:
      row.latitude !== null && row.longitude !== null
        ? {
            latitude: row.latitude,
            longitude: row.longitude
          }
        : null,
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
    }
  };
}

function visibilityClause(): string {
  return `
    (
      adventures.visibility = 'public'
      or exists (
        select 1
        from viewer
        where viewer.id = adventures.author_user_id
      )
      or (
        adventures.visibility = 'connections'
        and exists (
          select 1
          from viewer
          join public.connections
            on public.connections.status = 'accepted'
           and (
             (public.connections.user_id_low = viewer.id and public.connections.user_id_high = adventures.author_user_id)
             or
             (public.connections.user_id_high = viewer.id and public.connections.user_id_low = adventures.author_user_id)
           )
        )
      )
    )
  `;
}

const feedSelect = `
  select
    adventures.id::text as id,
    adventures.title,
    adventures.summary,
    adventures.body,
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
    adventure_stats.average_rating
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
}): Promise<AdventureCard[]> {
  const result = await db.query<AdventureFeedRow>(
    `
      with viewer as (
        select $1::uuid as id
      )
      ${feedSelect}
      ${feedJoins}
      where adventures.status = 'published'
        and ${visibilityClause()}
      order by coalesce(adventures.published_at, adventures.created_at) desc, adventures.id desc
      limit $2
      offset $3
    `,
    [options.viewerId ?? null, options.limit, options.offset]
  );

  return result.rows.map(mapAdventureCard);
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
      ${feedSelect},
      adventures.place_label,
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

export async function getMediaDeliveryTarget(options: {
  mediaId: string;
  viewerId?: string;
}): Promise<MediaDeliveryTarget | null> {
  const result = await db.query<MediaDeliveryRow>(
    `
      with viewer as (
        select $1::uuid as id
      )
      select
        media_assets.id::text as media_id,
        media_assets.storage_key,
        media_assets.mime_type,
        media_assets.byte_size,
        media_assets.width,
        media_assets.height,
        media_assets.updated_at::text as updated_at
      from public.media_assets media_assets
      join public.adventure_media adventure_media
        on adventure_media.media_asset_id = media_assets.id
      join public.adventures adventures
        on adventures.id = adventure_media.adventure_id
      where media_assets.id = $2::uuid
        and media_assets.deleted_at is null
        and adventures.status = 'published'
        and ${visibilityClause()}
      order by adventure_media.is_primary desc, adventure_media.sort_order asc
      limit 1
    `,
    [options.viewerId ?? null, options.mediaId]
  );

  const row = result.rows[0];
  if (!row) {
    return null;
  }

  return {
    id: row.media_id,
    storageKey: row.storage_key,
    mimeType: row.mime_type,
    byteSize: row.byte_size,
    width: row.width,
    height: row.height,
    updatedAt: row.updated_at
  };
}
