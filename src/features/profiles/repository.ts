import type { QueryResultRow } from "pg";

import { db } from "../../db/client.js";
import type { AdventureCard } from "../adventures/repository.js";

type ProfileRow = QueryResultRow & {
  user_id: string;
  handle: string;
  display_name: string | null;
  bio: string | null;
  home_city: string | null;
  home_region: string | null;
  avatar_media_id: string | null;
  avatar_storage_key: string | null;
  cover_media_id: string | null;
  cover_storage_key: string | null;
  created_at: string;
  updated_at: string;
};

type ProfileAdventureRow = QueryResultRow & {
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
  primary_media_id: string | null;
  primary_media_storage_key: string | null;
  favorite_count: number | null;
  comment_count: number | null;
  rating_count: number | null;
  average_rating: number | null;
};

export type ProfileDetail = {
  id: string;
  handle: string;
  displayName: string | null;
  bio: string | null;
  homeCity: string | null;
  homeRegion: string | null;
  avatar: {
    id: string;
    storageKey: string;
  } | null;
  cover: {
    id: string;
    storageKey: string;
  } | null;
  createdAt: string;
  updatedAt: string;
};

function mapProfile(row: ProfileRow): ProfileDetail {
  return {
    id: row.user_id,
    handle: row.handle,
    displayName: row.display_name,
    bio: row.bio,
    homeCity: row.home_city,
    homeRegion: row.home_region,
    avatar:
      row.avatar_media_id && row.avatar_storage_key
        ? {
            id: row.avatar_media_id,
            storageKey: row.avatar_storage_key
          }
        : null,
    cover:
      row.cover_media_id && row.cover_storage_key
        ? {
            id: row.cover_media_id,
            storageKey: row.cover_storage_key
          }
        : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapProfileAdventure(row: ProfileAdventureRow, author: ProfileDetail): AdventureCard {
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
      handle: author.handle,
      displayName: author.displayName,
      homeCity: author.homeCity,
      homeRegion: author.homeRegion
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

function profileAdventureVisibilityClause(): string {
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

export async function getProfileByHandle(handle: string): Promise<ProfileDetail | null> {
  const result = await db.query<ProfileRow>(
    `
      select
        users.id::text as user_id,
        users.handle,
        profiles.display_name,
        profiles.bio,
        profiles.home_city,
        profiles.home_region,
        avatar.id::text as avatar_media_id,
        avatar.storage_key as avatar_storage_key,
        cover.id::text as cover_media_id,
        cover.storage_key as cover_storage_key,
        users.created_at::text as created_at,
        users.updated_at::text as updated_at
      from public.users users
      left join public.profiles profiles
        on profiles.user_id = users.id
      left join public.media_assets avatar
        on avatar.id = profiles.avatar_media_asset_id
      left join public.media_assets cover
        on cover.id = profiles.cover_media_asset_id
      where users.handle = $1
      limit 1
    `,
    [handle]
  );

  const row = result.rows[0];
  return row ? mapProfile(row) : null;
}

export async function listProfileAdventures(options: {
  profileHandle: string;
  viewerId?: string;
  limit: number;
  offset: number;
}): Promise<AdventureCard[]> {
  const profile = await getProfileByHandle(options.profileHandle);
  if (!profile) {
    return [];
  }

  const result = await db.query<ProfileAdventureRow>(
    `
      with viewer as (
        select $1::uuid as id
      )
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
        media_assets.id::text as primary_media_id,
        media_assets.storage_key as primary_media_storage_key,
        adventure_stats.favorite_count,
        adventure_stats.comment_count,
        adventure_stats.rating_count,
        adventure_stats.average_rating
      from public.adventures adventures
      left join public.adventure_media adventure_media
        on adventure_media.adventure_id = adventures.id
       and adventure_media.is_primary = true
      left join public.media_assets media_assets
        on media_assets.id = adventure_media.media_asset_id
      left join public.adventure_stats adventure_stats
        on adventure_stats.adventure_id = adventures.id
      join public.users author
        on author.id = adventures.author_user_id
      where author.handle = $2
        and adventures.status = 'published'
        and ${profileAdventureVisibilityClause()}
      order by coalesce(adventures.published_at, adventures.created_at) desc, adventures.id desc
      limit $3
      offset $4
    `,
    [options.viewerId ?? null, options.profileHandle, options.limit, options.offset]
  );

  return result.rows.map((row) => mapProfileAdventure(row, profile));
}
