import { randomUUID } from "node:crypto";

import type { PoolClient, QueryResultRow } from "pg";

import { db } from "../../db/client.js";

type Queryable = PoolClient | typeof db;

type SidekickSummaryRow = QueryResultRow & {
  profile_id: string;
  handle: string;
  display_name: string | null;
  bio: string | null;
  home_city: string | null;
  home_region: string | null;
  avatar_media_id: string | null;
  avatar_storage_key: string | null;
  is_sidekick: boolean;
  adventures_count: string | number | null;
};

type SidekickTargetRow = QueryResultRow & {
  user_id: string;
  handle: string;
};

export type SidekickSummary = {
  profile: {
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
  };
  relationship: {
    isSidekick: boolean;
  };
  stats: {
    adventuresCount: number;
  };
};

function getExecutor(client?: PoolClient): Queryable {
  return client ?? db;
}

async function runQuery<TResult extends QueryResultRow>(
  client: PoolClient | undefined,
  text: string,
  values: unknown[]
) {
  const executor = getExecutor(client) as {
    query: (sql: string, params: unknown[]) => Promise<{ rows: TResult[] }>;
  };

  return executor.query(text, values);
}

function mapSidekickSummary(row: SidekickSummaryRow): SidekickSummary {
  return {
    profile: {
      id: row.profile_id,
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
          : null
    },
    relationship: {
      isSidekick: row.is_sidekick
    },
    stats: {
      adventuresCount: Number(row.adventures_count ?? 0)
    }
  };
}

const summarySelect = `
  select
    users.id::text as profile_id,
    users.handle,
    profiles.display_name,
    profiles.bio,
    profiles.home_city,
    profiles.home_region,
    avatar.id::text as avatar_media_id,
    avatar.storage_key as avatar_storage_key,
    exists (
      select 1
      from public.sidekick_grants sidekick_grants
      where sidekick_grants.grantor_user_id = $1::uuid
        and sidekick_grants.grantee_user_id = users.id
    ) as is_sidekick,
    count(adventures.id)::text as adventures_count
  from public.users users
  left join public.profiles profiles
    on profiles.user_id = users.id
  left join public.media_assets avatar
    on avatar.id = profiles.avatar_media_asset_id
  left join public.adventures adventures
    on adventures.author_user_id = users.id
   and adventures.status = 'published'
`;

const summaryGroupBy = `
  group by
    users.id,
    users.handle,
    profiles.display_name,
    profiles.bio,
    profiles.home_city,
    profiles.home_region,
    avatar.id,
    avatar.storage_key
`;

export async function listMySidekicks(options: {
  viewerId: string;
  limit: number;
  offset: number;
}): Promise<SidekickSummary[]> {
  const result = await db.query<SidekickSummaryRow>(
    `
      ${summarySelect}
      join public.sidekick_grants granted
        on granted.grantee_user_id = users.id
       and granted.grantor_user_id = $1::uuid
      where users.id <> $1::uuid
      ${summaryGroupBy}
      order by granted.created_at desc, users.id desc
      limit $2
      offset $3
    `,
    [options.viewerId, options.limit, options.offset]
  );

  return result.rows.map(mapSidekickSummary);
}

export async function listDiscoveredProfiles(options: {
  viewerId: string;
  limit: number;
  offset: number;
}): Promise<SidekickSummary[]> {
  const result = await db.query<SidekickSummaryRow>(
    `
      ${summarySelect}
      where users.id <> $1::uuid
      ${summaryGroupBy}
      order by users.created_at desc, users.id desc
      limit $2
      offset $3
    `,
    [options.viewerId, options.limit, options.offset]
  );

  return result.rows.map(mapSidekickSummary);
}

export async function searchProfiles(options: {
  viewerId: string;
  query: string;
  limit: number;
  offset: number;
}): Promise<SidekickSummary[]> {
  const needle = `%${options.query}%`;
  const prefix = `${options.query}%`;

  const result = await db.query<SidekickSummaryRow>(
    `
      ${summarySelect}
      where users.id <> $1::uuid
        and (
          users.handle ilike $4
          or coalesce(profiles.display_name, '') ilike $4
          or coalesce(profiles.home_city, '') ilike $4
          or coalesce(profiles.home_region, '') ilike $4
        )
      ${summaryGroupBy}
      order by
        case
          when lower(users.handle) = lower($5) then 0
          when users.handle ilike $6 then 1
          when coalesce(profiles.display_name, '') ilike $6 then 2
          when coalesce(profiles.home_city, '') ilike $6 then 3
          when coalesce(profiles.home_region, '') ilike $6 then 4
          else 5
        end,
        users.created_at desc,
        users.id desc
      limit $2
      offset $3
    `,
    [options.viewerId, options.limit, options.offset, needle, options.query, prefix]
  );

  return result.rows.map(mapSidekickSummary);
}

async function getTargetByHandle(handle: string, client?: PoolClient): Promise<SidekickTargetRow | null> {
  const result = await runQuery<SidekickTargetRow>(
    client,
    `
      select
        users.id::text as user_id,
        users.handle
      from public.users users
      where users.handle = $1
      limit 1
    `,
    [handle]
  );

  return result.rows[0] ?? null;
}

async function readSummaryForTarget(
  viewerId: string,
  targetUserId: string,
  client?: PoolClient
): Promise<SidekickSummary | null> {
  const result = await runQuery<SidekickSummaryRow>(
    client,
    `
      ${summarySelect}
      where users.id = $2::uuid
      ${summaryGroupBy}
      limit 1
    `,
    [viewerId, targetUserId]
  );

  const row = result.rows[0];
  return row ? mapSidekickSummary(row) : null;
}

export async function addSidekickGrant(options: {
  viewerId: string;
  handle: string;
}, client?: PoolClient): Promise<SidekickSummary | null> {
  const target = await getTargetByHandle(options.handle, client);
  if (!target) {
    return null;
  }

  await runQuery(
    client,
    `
      insert into public.sidekick_grants (
        id,
        grantor_user_id,
        grantee_user_id,
        created_at,
        updated_at
      ) values (
        $1::uuid,
        $2::uuid,
        $3::uuid,
        now(),
        now()
      )
      on conflict (grantor_user_id, grantee_user_id)
      do update set updated_at = public.sidekick_grants.updated_at
    `,
    [randomUUID(), options.viewerId, target.user_id]
  );

  return readSummaryForTarget(options.viewerId, target.user_id, client);
}

export async function removeSidekickGrant(options: {
  viewerId: string;
  handle: string;
}, client?: PoolClient): Promise<SidekickSummary | null> {
  const target = await getTargetByHandle(options.handle, client);
  if (!target) {
    return null;
  }

  await runQuery(
    client,
    `
      delete from public.sidekick_grants
      where grantor_user_id = $1::uuid
        and grantee_user_id = $2::uuid
    `,
    [options.viewerId, target.user_id]
  );

  return readSummaryForTarget(options.viewerId, target.user_id, client);
}
