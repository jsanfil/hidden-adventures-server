import { randomUUID } from "node:crypto";

import type { PoolClient, QueryResult, QueryResultRow } from "pg";

import { db } from "../../db/client.js";
import { normalizeApiTimestamp, type ApiTimestampInput } from "../../lib/api-timestamp.js";
import { toApiAdventureVisibility } from "./visibility.js";

type Queryable = PoolClient | typeof db;

type AdventureFeedRow = QueryResultRow & {
  id: string;
  title: string;
  description: string | null;
  category_slug: string | null;
  visibility: string;
  created_at: ApiTimestampInput;
  published_at: ApiTimestampInput | null;
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
  is_favorited: boolean | null;
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
  isFavorited: boolean;
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
  updated_at: ApiTimestampInput;
};

type AdventureMediaRow = QueryResultRow & {
  media_id: string;
  sort_order: number;
  is_primary: boolean;
  width: number | null;
  height: number | null;
};

type AdventureCommentRow = QueryResultRow & {
  id: string;
  body: string;
  created_at: ApiTimestampInput;
  updated_at: ApiTimestampInput;
  author_handle: string;
  author_display_name: string | null;
  author_home_city: string | null;
  author_home_region: string | null;
};

export type AdventureMediaItem = {
  id: string;
  sortOrder: number;
  isPrimary: boolean;
  width: number | null;
  height: number | null;
};

export type AdventureComment = {
  id: string;
  body: string;
  createdAt: string;
  updatedAt: string;
  author: {
    handle: string;
    displayName: string | null;
    homeCity: string | null;
    homeRegion: string | null;
  };
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

function getExecutor(client?: PoolClient): Queryable {
  return client ?? db;
}

async function runQuery<TResult extends QueryResultRow>(
  client: PoolClient | undefined,
  text: string,
  values: unknown[]
): Promise<QueryResult<TResult>> {
  const executor = getExecutor(client) as {
    query: (sql: string, params: unknown[]) => Promise<QueryResult<TResult>>;
  };

  return executor.query(text, values);
}

function mapAdventureCard(row: AdventureFeedRow): AdventureCard {
  const distanceMiles = row.distance_miles;

  return {
    id: row.id,
    title: row.title,
    description: row.description,
    categorySlug: row.category_slug,
    visibility: toApiAdventureVisibility(row.visibility),
    createdAt: normalizeApiTimestamp(row.created_at)!,
    publishedAt: normalizeApiTimestamp(row.published_at),
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
    isFavorited: row.is_favorited ?? false,
    ...(distanceMiles !== null && distanceMiles !== undefined ? { distanceMiles } : {})
  };
}

function mapAdventureComment(row: AdventureCommentRow): AdventureComment {
  return {
    id: row.id,
    body: row.body,
    createdAt: normalizeApiTimestamp(row.created_at)!,
    updatedAt: normalizeApiTimestamp(row.updated_at)!,
    author: {
      handle: row.author_handle,
      displayName: row.author_display_name,
      homeCity: row.author_home_city,
      homeRegion: row.author_home_region
    }
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
    adventures.created_at as created_at,
    adventures.published_at as published_at,
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

async function getVisibleAdventureById(
  options: {
    adventureId: string;
    viewerId?: string;
  },
  client?: PoolClient
): Promise<(AdventureCard & { placeLabel: string | null; updatedAt: string }) | null> {
  const result = await runQuery<AdventureDetailRow>(
    client,
    `
      with viewer as (
        select $1::uuid as id
      )
      ${adventureBaseSelect},
      adventures.updated_at as updated_at
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
    updatedAt: normalizeApiTimestamp(row.updated_at)!
  };
}

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
  return getVisibleAdventureById(options);
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

export async function listAdventureComments(options: {
  adventureId: string;
  viewerId?: string;
  limit: number;
  offset: number;
}): Promise<AdventureComment[] | null> {
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

  const result = await db.query<AdventureCommentRow>(
    `
      select
        adventure_comments.id::text as id,
        adventure_comments.body,
        adventure_comments.created_at as created_at,
        adventure_comments.updated_at as updated_at,
        users.handle as author_handle,
        profiles.display_name as author_display_name,
        profiles.home_city as author_home_city,
        profiles.home_region as author_home_region
      from public.adventure_comments adventure_comments
      join public.users users
        on users.id = adventure_comments.author_user_id
      left join public.profiles profiles
        on profiles.user_id = users.id
      where adventure_comments.adventure_id = $1::uuid
        and adventure_comments.deleted_at is null
      order by adventure_comments.created_at asc, adventure_comments.id asc
      limit $2
      offset $3
    `,
    [options.adventureId, options.limit, options.offset]
  );

  return result.rows.map(mapAdventureComment);
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

export async function createAdventureComment(options: {
  adventureId: string;
  authorUserId: string;
  body: string;
}): Promise<AdventureComment | null> {
  const visibleAdventure = await getVisibleAdventureById({
    adventureId: options.adventureId,
    viewerId: options.authorUserId
  });

  if (!visibleAdventure) {
    return null;
  }

  const commentId = randomUUID();
  const result = await db.query<AdventureCommentRow>(
    `
      with inserted_comment as (
        insert into public.adventure_comments (
          id,
          adventure_id,
          author_user_id,
          body,
          created_at,
          updated_at,
          deleted_at
        ) values (
          $1::uuid,
          $2::uuid,
          $3::uuid,
          $4,
          now(),
          now(),
          null
        )
        returning
          id,
          body,
          created_at,
          updated_at,
          author_user_id
      )
      select
        inserted_comment.id::text as id,
        inserted_comment.body,
        inserted_comment.created_at as created_at,
        inserted_comment.updated_at as updated_at,
        users.handle as author_handle,
        profiles.display_name as author_display_name,
        profiles.home_city as author_home_city,
        profiles.home_region as author_home_region
      from inserted_comment
      join public.users users
        on users.id = inserted_comment.author_user_id
      left join public.profiles profiles
        on profiles.user_id = users.id
    `,
    [commentId, options.adventureId, options.authorUserId, options.body]
  );

  await db.query(
    `
      insert into public.adventure_stats (
        adventure_id,
        favorite_count,
        comment_count,
        rating_count,
        rating_sum,
        average_rating,
        updated_at
      )
      select
        $1::uuid,
        coalesce(favorites.favorite_count, 0),
        coalesce(comments.comment_count, 0),
        coalesce(ratings.rating_count, 0),
        coalesce(ratings.rating_sum, 0),
        coalesce(ratings.average_rating, 0),
        now()
      from (
        select count(*)::int as favorite_count
        from public.adventure_favorites
        where adventure_id = $1::uuid
      ) favorites
      cross join (
        select count(*)::int as comment_count
        from public.adventure_comments
        where adventure_id = $1::uuid
          and deleted_at is null
      ) comments
      cross join (
        select
          count(*)::int as rating_count,
          coalesce(sum(score)::double precision, 0) as rating_sum,
          coalesce(avg(score)::double precision, 0) as average_rating
        from public.adventure_ratings
        where adventure_id = $1::uuid
      ) ratings
      on conflict (adventure_id) do update set
        favorite_count = excluded.favorite_count,
        comment_count = excluded.comment_count,
        rating_count = excluded.rating_count,
        rating_sum = excluded.rating_sum,
        average_rating = excluded.average_rating,
        updated_at = excluded.updated_at
    `,
    [options.adventureId]
  );

  const row = result.rows[0];
  return row ? mapAdventureComment(row) : null;
}

export async function insertAdventureFavorite(
  options: {
    viewerId: string;
    adventureId: string;
  },
  client?: PoolClient
): Promise<(AdventureCard & { placeLabel: string | null; updatedAt: string }) | null> {
  const visibleAdventure = await getVisibleAdventureById(options, client);
  if (!visibleAdventure) {
    return null;
  }

  await runQuery(
    client,
    `
      insert into public.adventure_favorites (
        user_id,
        adventure_id,
        created_at
      ) values (
        $1::uuid,
        $2::uuid,
        now()
      )
      on conflict (user_id, adventure_id) do nothing
    `,
    [options.viewerId, options.adventureId]
  );

  return getVisibleAdventureById(options, client);
}

export async function deleteAdventureFavorite(
  options: {
    viewerId: string;
    adventureId: string;
  },
  client?: PoolClient
): Promise<(AdventureCard & { placeLabel: string | null; updatedAt: string }) | null> {
  const visibleAdventure = await getVisibleAdventureById(options, client);
  if (!visibleAdventure) {
    return null;
  }

  await runQuery(
    client,
    `
      delete from public.adventure_favorites
      where user_id = $1::uuid
        and adventure_id = $2::uuid
    `,
    [options.viewerId, options.adventureId]
  );

  return getVisibleAdventureById(options, client);
}
