import type { QueryResultRow } from "pg";

import { db } from "../../db/client.js";
import type { AdventureCard } from "../adventures/repository.js";
import { toApiAdventureVisibility } from "../adventures/visibility.js";
import type { CanonicalCategorySlug } from "../adventures/category-taxonomy.js";

type DiscoverAdventurerRow = QueryResultRow & {
  id: string;
  handle: string;
  display_name: string | null;
  home_city: string | null;
  home_region: string | null;
  avatar_media_id: string | null;
  avatar_storage_key: string | null;
  preview_media_id: string | null;
  preview_media_storage_key: string | null;
  public_adventure_count: string | number;
  top_category_slugs: string[] | null;
};

type DiscoverAdventureRow = QueryResultRow & {
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
  is_favorited: boolean | null;
};

export type DiscoverAdventurer = {
  id: string;
  handle: string;
  displayName: string | null;
  homeCity: string | null;
  homeRegion: string | null;
  avatar: {
    id: string;
    storageKey: string;
  } | null;
  previewMedia: {
    id: string;
    storageKey: string;
  } | null;
  publicAdventureCount: number;
  topCategorySlugs: CanonicalCategorySlug[];
};

export type DiscoverHomeModule =
  | {
      id: "explore-adventurers";
      type: "adventurers";
      title: "Explore Adventurers";
      items: DiscoverAdventurer[];
    }
  | {
      id: "popular-adventures";
      type: "adventures";
      title: "Popular Adventures";
      items: AdventureCard[];
    };

export type DiscoverHomeResponse = {
  modules: DiscoverHomeModule[];
};

export type DiscoverSearchResponse = {
  query: string;
  people: {
    items: DiscoverAdventurer[];
  };
  adventures: {
    items: AdventureCard[];
  };
};

function mapDiscoverAdventurer(row: DiscoverAdventurerRow): DiscoverAdventurer {
  return {
    id: row.id,
    handle: row.handle,
    displayName: row.display_name,
    homeCity: row.home_city,
    homeRegion: row.home_region,
    avatar:
      row.avatar_media_id && row.avatar_storage_key
        ? {
            id: row.avatar_media_id,
            storageKey: row.avatar_storage_key
          }
        : null,
    previewMedia:
      row.preview_media_id && row.preview_media_storage_key
        ? {
            id: row.preview_media_id,
            storageKey: row.preview_media_storage_key
          }
        : null,
    publicAdventureCount: Number(row.public_adventure_count ?? 0),
    topCategorySlugs: ((row.top_category_slugs ?? []) as CanonicalCategorySlug[]).slice(0, 2)
  };
}

function mapAdventureCard(row: DiscoverAdventureRow): AdventureCard {
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
    isFavorited: row.is_favorited ?? false
  };
}

const discoverAdventureSelect = `
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
    adventures.place_label,
    exists (
      select 1
      from viewer
      join public.adventure_favorites
        on public.adventure_favorites.user_id = viewer.id
      where public.adventure_favorites.adventure_id = adventures.id
    ) as is_favorited
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

const discoverTopCategoriesLateral = `
  left join lateral (
    select
      array_agg(top_categories.category_slug order by top_categories.category_count desc, top_categories.latest_published_at desc, top_categories.category_slug asc) as top_category_slugs
    from (
      select
        category_slug,
        count(*) as category_count,
        max(published_at) as latest_published_at
      from public.adventures
      where author_user_id = users.id
        and status = 'published'
        and visibility = 'public'
        and category_slug is not null
      group by category_slug
      order by
        category_count desc,
        latest_published_at desc,
        category_slug asc
      limit 2
    ) top_categories
  ) top_categories on true
`;

export async function listDiscoverHome(viewerId: string): Promise<DiscoverHomeResponse> {
  const adventurersResult = await db.query<DiscoverAdventurerRow>(
    `
      with ranked_adventurers as (
        select
          users.id::text as id,
          users.handle,
          profiles.display_name,
          profiles.home_city,
          profiles.home_region,
          avatar.id::text as avatar_media_id,
          avatar.storage_key as avatar_storage_key,
          preview_media.id::text as preview_media_id,
          preview_media.storage_key as preview_media_storage_key,
          count(adventures.id)::text as public_adventure_count,
          coalesce(top_categories.top_category_slugs, '{}'::text[]) as top_category_slugs,
          max(adventures.published_at) as latest_public_published_at
        from public.users users
        join public.adventures adventures
          on adventures.author_user_id = users.id
         and adventures.status = 'published'
         and adventures.visibility = 'public'
        left join public.profiles profiles
          on profiles.user_id = users.id
        left join public.media_assets avatar
          on avatar.id = profiles.avatar_media_asset_id
        left join lateral (
          select
            recent_media.id,
            recent_media.storage_key
          from public.adventures recent_adventures
          left join public.adventure_media recent_adventure_media
            on recent_adventure_media.adventure_id = recent_adventures.id
           and recent_adventure_media.is_primary = true
          left join public.media_assets recent_media
            on recent_media.id = recent_adventure_media.media_asset_id
          where recent_adventures.author_user_id = users.id
            and recent_adventures.status = 'published'
            and recent_adventures.visibility = 'public'
          order by recent_adventures.published_at desc nulls last, recent_adventures.id desc
          limit 1
        ) preview_media on true
        ${discoverTopCategoriesLateral}
        group by
          users.id,
          users.handle,
          profiles.display_name,
          profiles.home_city,
          profiles.home_region,
          avatar.id,
          avatar.storage_key,
          top_categories.top_category_slugs,
          preview_media.id,
          preview_media.storage_key
      )
      select
        id,
        handle,
        display_name,
        home_city,
        home_region,
        avatar_media_id,
        avatar_storage_key,
        preview_media_id,
        preview_media_storage_key,
        public_adventure_count,
        top_category_slugs
      from ranked_adventurers
      order by
        public_adventure_count::int desc,
        latest_public_published_at desc,
        id desc
      limit 10
    `
  );

  const adventuresResult = await db.query<DiscoverAdventureRow>(
    `
      with viewer as (
        select $1::uuid as id
      )
      ${discoverAdventureSelect}
      where adventures.status = 'published'
        and adventures.visibility = 'public'
      order by
        adventure_stats.favorite_count desc nulls last,
        adventure_stats.comment_count desc nulls last,
        adventure_stats.average_rating desc nulls last,
        adventures.published_at desc nulls last,
        adventures.id desc
      limit 10
    `,
    [viewerId]
  );

  return {
    modules: [
      {
        id: "explore-adventurers",
        type: "adventurers",
        title: "Explore Adventurers",
        items: adventurersResult.rows.map(mapDiscoverAdventurer)
      },
      {
        id: "popular-adventures",
        type: "adventures",
        title: "Popular Adventures",
        items: adventuresResult.rows.map(mapAdventureCard)
      }
    ]
  };
}

export async function searchDiscover(options: {
  viewerId: string;
  query: string;
  limit: number;
  offset: number;
}): Promise<DiscoverSearchResponse> {
  const needle = `%${options.query}%`;
  const prefix = `${options.query}%`;

  const peopleResult = await db.query<DiscoverAdventurerRow>(
    `
      with matching_adventurers as (
        select
          users.id::text as id,
          users.handle,
          profiles.display_name,
          profiles.home_city,
          profiles.home_region,
          avatar.id::text as avatar_media_id,
          avatar.storage_key as avatar_storage_key,
          preview_media.id::text as preview_media_id,
          preview_media.storage_key as preview_media_storage_key,
          count(adventures.id)::text as public_adventure_count,
          coalesce(top_categories.top_category_slugs, '{}'::text[]) as top_category_slugs,
          max(adventures.published_at) as latest_public_published_at
        from public.users users
        join public.adventures adventures
          on adventures.author_user_id = users.id
         and adventures.status = 'published'
         and adventures.visibility = 'public'
        left join public.profiles profiles
          on profiles.user_id = users.id
        left join public.media_assets avatar
          on avatar.id = profiles.avatar_media_asset_id
        left join lateral (
          select
            recent_media.id,
            recent_media.storage_key
          from public.adventures recent_adventures
          left join public.adventure_media recent_adventure_media
            on recent_adventure_media.adventure_id = recent_adventures.id
           and recent_adventure_media.is_primary = true
          left join public.media_assets recent_media
            on recent_media.id = recent_adventure_media.media_asset_id
          where recent_adventures.author_user_id = users.id
            and recent_adventures.status = 'published'
            and recent_adventures.visibility = 'public'
          order by recent_adventures.published_at desc nulls last, recent_adventures.id desc
          limit 1
        ) preview_media on true
        ${discoverTopCategoriesLateral}
        where users.handle ilike $3
          or coalesce(profiles.display_name, '') ilike $3
        group by
          users.id,
          users.handle,
          profiles.display_name,
          profiles.home_city,
          profiles.home_region,
          avatar.id,
          avatar.storage_key,
          top_categories.top_category_slugs,
          preview_media.id,
          preview_media.storage_key
      )
      select
        id,
        handle,
        display_name,
        home_city,
        home_region,
        avatar_media_id,
        avatar_storage_key,
        preview_media_id,
        preview_media_storage_key,
        public_adventure_count,
        top_category_slugs
      from matching_adventurers
      order by
        case
          when lower(handle) = lower($4) then 0
          when coalesce(lower(display_name), '') = lower($4) then 1
          when handle ilike $5 then 2
          when coalesce(display_name, '') ilike $5 then 3
          else 4
        end,
        public_adventure_count::int desc,
        latest_public_published_at desc,
        id desc
      limit $1
      offset $2
    `,
    [options.limit, options.offset, needle, options.query, prefix]
  );

  const adventuresResult = await db.query<DiscoverAdventureRow>(
    `
      with viewer as (
        select $6::uuid as id
      )
      ${discoverAdventureSelect}
      where adventures.status = 'published'
        and adventures.visibility = 'public'
        and (
          adventures.title ilike $3
          or coalesce(adventures.place_label, '') ilike $3
        )
      order by
        case
          when lower(adventures.title) = lower($4) then 0
          when coalesce(lower(adventures.place_label), '') = lower($4) then 1
          when adventures.title ilike $5 then 2
          when coalesce(adventures.place_label, '') ilike $5 then 3
          else 4
        end,
        adventures.published_at desc nulls last,
        adventures.id desc
      limit $1
      offset $2
    `,
    [options.limit, options.offset, needle, options.query, prefix, options.viewerId]
  );

  return {
    query: options.query,
    people: {
      items: peopleResult.rows.map(mapDiscoverAdventurer)
    },
    adventures: {
      items: adventuresResult.rows.map(mapAdventureCard)
    }
  };
}
