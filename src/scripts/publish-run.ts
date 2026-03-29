import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import type { PoolClient } from "pg";

import { db } from "../db/client.js";

type CliOptions = {
  runId: number;
  reportPath?: string;
};

type CountRow = {
  count: string;
};

type AuditCountRow = {
  source_collection: string;
  action: string;
  count: string;
};

type PublishReport = {
  runId: number;
  workCounts: Record<string, number>;
  publicCounts: Record<string, number>;
  auditCounts: Record<string, number>;
  checks: Array<{
    name: string;
    pass: boolean;
    expected: number;
    actual: number;
  }>;
};

function parseArgs(argv: string[]): CliOptions {
  let runId: number | undefined;
  let reportPath: string | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--run-id") {
      const value = Number(argv[index + 1]);
      if (!Number.isInteger(value) || value <= 0) {
        throw new Error("Expected a positive integer after --run-id.");
      }
      runId = value;
      index += 1;
      continue;
    }

    if (arg === "--report") {
      reportPath = argv[index + 1];
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!runId) {
    throw new Error("Missing required --run-id <number> argument.");
  }

  return { runId, reportPath };
}

async function ensureRunReady(client: PoolClient, runId: number) {
  const result = await client.query<{ exists: boolean }>(
    `
      select exists(
        select 1
        from migration_meta.import_runs
        where id = $1
      ) as exists
    `,
    [runId]
  );

  if (!result.rows[0]?.exists) {
    throw new Error(`Import run ${runId} does not exist.`);
  }
}

async function clearPublicTables(client: PoolClient) {
  const statements = [
    "delete from public.adventure_stats",
    "delete from public.adventure_ratings",
    "delete from public.adventure_comments",
    "delete from public.adventure_favorites",
    "delete from public.adventure_media",
    "delete from public.adventures",
    "delete from public.connections",
    "delete from public.profiles",
    "delete from public.media_assets",
    "delete from public.users"
  ];

  for (const statement of statements) {
    await client.query(statement);
  }
}

async function publishUsers(client: PoolClient, runId: number) {
  await client.query(
    `
      insert into public.users (
        id,
        cognito_subject,
        handle,
        email,
        account_origin,
        status,
        created_at,
        updated_at,
        deleted_at
      )
      select
        user_id,
        cognito_subject,
        handle,
        email,
        'legacy_profile_import',
        status,
        created_at,
        updated_at,
        null
      from migration_work.users_work
      where run_id = $1
    `,
    [runId]
  );
}

async function publishMediaAssets(client: PoolClient, runId: number) {
  await client.query(
    `
      insert into public.media_assets (
        id,
        owner_user_id,
        storage_key,
        kind,
        moderation_status,
        created_at,
        updated_at,
        deleted_at
      )
      select
        media_asset_id,
        owner_user_id,
        storage_key,
        kind,
        moderation_status::public.media_moderation_status,
        created_at,
        updated_at,
        null
      from migration_work.media_assets_work
      where run_id = $1
    `,
    [runId]
  );
}

async function publishProfiles(client: PoolClient, runId: number) {
  await client.query(
    `
      insert into public.profiles (
        user_id,
        display_name,
        bio,
        home_city,
        home_region,
        avatar_media_asset_id,
        cover_media_asset_id,
        created_at,
        updated_at
      )
      select
        p.user_id,
        p.display_name,
        null,
        p.home_city,
        p.home_region,
        avatar.id,
        cover.id,
        p.created_at,
        p.updated_at
      from migration_work.profiles_work p
      left join public.media_assets avatar
        on avatar.storage_key = p.avatar_storage_key
      left join public.media_assets cover
        on cover.storage_key = p.cover_storage_key
      where p.run_id = $1
    `,
    [runId]
  );
}

async function publishConnections(client: PoolClient, runId: number) {
  await client.query(
    `
      insert into public.connections (
        id,
        user_id_low,
        user_id_high,
        initiated_by_user_id,
        status,
        requested_at,
        responded_at,
        updated_at
      )
      select
        connection_id,
        least(user_id_low, user_id_high),
        greatest(user_id_low, user_id_high),
        initiated_by_user_id,
        status::public.connection_status,
        requested_at,
        responded_at,
        updated_at
      from migration_work.connections_work
      where run_id = $1
    `,
    [runId]
  );
}

async function publishAdventures(client: PoolClient, runId: number) {
  await client.query(
    `
      insert into public.adventures (
        id,
        author_user_id,
        title,
        summary,
        body,
        category_slug,
        visibility,
        status,
        location,
        place_label,
        created_at,
        updated_at,
        published_at,
        archived_at
      )
      select
        adventure_id,
        author_user_id,
        title,
        summary,
        body,
        category_slug,
        visibility::public.adventure_visibility,
        status::public.adventure_status,
        case
          when longitude is not null and latitude is not null
            then ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)::geography
          else null
        end,
        null,
        created_at,
        updated_at,
        published_at,
        null
      from migration_work.adventures_work
      where run_id = $1
    `,
    [runId]
  );
}

async function publishAdventureMedia(client: PoolClient, runId: number) {
  await client.query(
    `
      insert into public.adventure_media (
        adventure_id,
        media_asset_id,
        sort_order,
        is_primary,
        created_at
      )
      select
        a.adventure_id,
        m.media_asset_id,
        0,
        true,
        a.created_at
      from migration_work.adventures_work a
      join migration_work.media_assets_work m
        on m.run_id = a.run_id
       and m.storage_key = a.default_image_key
      where a.run_id = $1
        and a.default_image_key is not null
    `,
    [runId]
  );
}

async function publishFavorites(client: PoolClient, runId: number) {
  await client.query(
    `
      insert into public.adventure_favorites (
        user_id,
        adventure_id,
        created_at
      )
      select
        user_id,
        adventure_id,
        coalesce(created_at, now())
      from migration_work.adventure_favorites_work
      where run_id = $1
    `,
    [runId]
  );
}

async function publishComments(client: PoolClient, runId: number) {
  await client.query(
    `
      insert into public.adventure_comments (
        id,
        adventure_id,
        author_user_id,
        body,
        created_at,
        updated_at,
        deleted_at
      )
      select
        comment_id,
        adventure_id,
        author_user_id,
        body,
        created_at,
        updated_at,
        null
      from migration_work.adventure_comments_work
      where run_id = $1
    `,
    [runId]
  );
}

async function publishAdventureStats(client: PoolClient, runId: number) {
  await client.query(
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
        a.id,
        coalesce(f.favorite_count, 0),
        coalesce(c.comment_count, 0),
        coalesce(r.legacy_rating_count, 0),
        coalesce(r.legacy_rating_sum, 0),
        coalesce(r.average_rating, 0),
        now()
      from public.adventures a
      left join (
        select adventure_id, count(*)::int as favorite_count
        from public.adventure_favorites
        group by adventure_id
      ) f
        on f.adventure_id = a.id
      left join (
        select adventure_id, count(*)::int as comment_count
        from public.adventure_comments
        group by adventure_id
      ) c
        on c.adventure_id = a.id
      left join migration_work.adventure_rating_projection_work r
        on r.run_id = $1
       and r.adventure_id = a.id
    `,
    [runId]
  );
}

async function markRunPublished(client: PoolClient, runId: number) {
  await client.query(
    `
      update migration_meta.import_runs
      set
        status = 'published',
        completed_at = now()
      where id = $1
    `,
    [runId]
  );
}

async function getCount(client: PoolClient, query: string, values: unknown[] = []): Promise<number> {
  const result = await client.query<CountRow>(query, values);
  return Number(result.rows[0]?.count ?? 0);
}

async function buildReport(client: PoolClient, runId: number): Promise<PublishReport> {
  const workCounts = {
    users: await getCount(client, "select count(*)::text as count from migration_work.users_work where run_id = $1", [runId]),
    profiles: await getCount(client, "select count(*)::text as count from migration_work.profiles_work where run_id = $1", [runId]),
    adventures: await getCount(client, "select count(*)::text as count from migration_work.adventures_work where run_id = $1", [runId]),
    connections: await getCount(client, "select count(*)::text as count from migration_work.connections_work where run_id = $1", [runId]),
    favorites: await getCount(client, "select count(*)::text as count from migration_work.adventure_favorites_work where run_id = $1", [runId]),
    comments: await getCount(client, "select count(*)::text as count from migration_work.adventure_comments_work where run_id = $1", [runId]),
    mediaAssets: await getCount(client, "select count(*)::text as count from migration_work.media_assets_work where run_id = $1", [runId]),
    ratingProjections: await getCount(client, "select count(*)::text as count from migration_work.adventure_rating_projection_work where run_id = $1", [runId])
  };

  const publicCounts = {
    users: await getCount(client, "select count(*)::text as count from public.users"),
    profiles: await getCount(client, "select count(*)::text as count from public.profiles"),
    adventures: await getCount(client, "select count(*)::text as count from public.adventures"),
    connections: await getCount(client, "select count(*)::text as count from public.connections"),
    favorites: await getCount(client, "select count(*)::text as count from public.adventure_favorites"),
    comments: await getCount(client, "select count(*)::text as count from public.adventure_comments"),
    mediaAssets: await getCount(client, "select count(*)::text as count from public.media_assets"),
    adventureMedia: await getCount(client, "select count(*)::text as count from public.adventure_media"),
    adventureStats: await getCount(client, "select count(*)::text as count from public.adventure_stats")
  };

  const auditRows = await client.query<AuditCountRow>(
    `
      select source_collection, action, count(*)::text as count
      from migration_meta.import_audit
      where run_id = $1
      group by source_collection, action
      order by source_collection, action
    `,
    [runId]
  );

  const auditCounts = Object.fromEntries(
    auditRows.rows.map((row) => [`${row.source_collection}.${row.action}`, Number(row.count)])
  );

  const checks = [
    { name: "users published matches work", expected: workCounts.users, actual: publicCounts.users },
    { name: "profiles published matches work", expected: workCounts.profiles, actual: publicCounts.profiles },
    { name: "adventures published matches work", expected: workCounts.adventures, actual: publicCounts.adventures },
    { name: "connections published matches work", expected: workCounts.connections, actual: publicCounts.connections },
    { name: "favorites published matches work", expected: workCounts.favorites, actual: publicCounts.favorites },
    { name: "comments published matches work", expected: workCounts.comments, actual: publicCounts.comments },
    { name: "media assets published matches work", expected: workCounts.mediaAssets, actual: publicCounts.mediaAssets },
    { name: "adventure stats published matches rating projections", expected: workCounts.ratingProjections, actual: publicCounts.adventureStats }
  ].map((item) => ({
    ...item,
    pass: item.expected === item.actual
  }));

  return {
    runId,
    workCounts,
    publicCounts,
    auditCounts,
    checks
  };
}

async function writeReport(reportPath: string, report: PublishReport) {
  const absoluteReportPath = path.resolve(process.cwd(), reportPath);
  await mkdir(path.dirname(absoluteReportPath), { recursive: true });
  await writeFile(absoluteReportPath, JSON.stringify(report, null, 2) + "\n", "utf8");
}

async function run() {
  const options = parseArgs(process.argv.slice(2));

  const report = await db.withTransaction<PublishReport>(async (client) => {
    await ensureRunReady(client, options.runId);
    await clearPublicTables(client);
    await publishUsers(client, options.runId);
    await publishMediaAssets(client, options.runId);
    await publishProfiles(client, options.runId);
    await publishConnections(client, options.runId);
    await publishAdventures(client, options.runId);
    await publishAdventureMedia(client, options.runId);
    await publishFavorites(client, options.runId);
    await publishComments(client, options.runId);
    await publishAdventureStats(client, options.runId);
    await markRunPublished(client, options.runId);

    return buildReport(client, options.runId);
  });

  if (options.reportPath) {
    await writeReport(options.reportPath, report);
  }

  console.log(JSON.stringify(report, null, 2));
}

run()
  .catch((error: unknown) => {
    console.error("Publish run failed.", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.close();
  });
