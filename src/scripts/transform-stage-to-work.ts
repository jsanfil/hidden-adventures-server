import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import type { PoolClient } from "pg";

import { db } from "../db/client.js";
import { normalizeAdventureCategorySlug } from "../features/adventures/category-taxonomy.js";
import {
  appendImportAudit,
  coerceTimestamp,
  insertImportMap,
  nullableString,
  stableUuid
} from "./lib/migration-work.js";
import {
  excludedLegacyProfileReason,
  shouldExcludeLegacyProfileHandle
} from "./lib/legacy-profile-exclusions.js";

type CliOptions = {
  runId: number;
  reportPath?: string;
};

type ProfileRaw = {
  _id?: string;
  username?: string;
  email?: string;
  fullName?: string;
  city?: string;
  state?: string;
  profileImage?: string;
  backgroundImage?: string;
  createdAt?: string;
  updatedAt?: string;
};

type AdventureLocation = {
  coordinates?: unknown[];
};

type AdventureRaw = {
  _id?: string;
  author?: string;
  name?: string;
  desc?: string;
  category?: string;
  access?: string;
  defaultImage?: string;
  location?: AdventureLocation;
  rating?: number;
  ratingCount?: number;
  createdAt?: string;
  updatedAt?: string;
  acl?: unknown[];
};

type SidekickRaw = {
  _id?: string;
  username?: string;
  sidekickName?: string;
  createdAt?: string;
  updatedAt?: string;
};

type FavoriteRaw = {
  _id?: string;
  username?: string;
  adventureID?: string;
  createdAt?: string;
  updatedAt?: string;
};

type CommentRaw = {
  _id?: string;
  username?: string;
  adventureID?: string;
  text?: string;
  createdAt?: string;
  updatedAt?: string;
};

type RawRow<TPayload> = {
  source_key: string;
  payload_json: TPayload;
};

type ProfileWorkSeed = {
  userId: string;
  handle: string;
  email: string | null;
  createdAt: string;
  updatedAt: string;
};

type ProfileCandidate = {
  row: RawRow<ProfileRaw>;
  handle: string;
  createdAt: string;
  updatedAt: string;
};

type MediaSeed = {
  mediaAssetId: string;
  ownerUserId: string;
  storageKey: string;
  kind: string;
  createdAt: string;
  updatedAt: string;
};

type AdventureWorkSeed = {
  adventureId: string;
};

type ConnectionCandidate = {
  row: RawRow<SidekickRaw>;
  initiatorHandle: string;
  partnerHandle: string;
  createdAt: string;
  updatedAt: string;
};

type TransformSummary = {
  runId: number;
  usersImported: number;
  profilesImported: number;
  adventuresImported: number;
  ratingProjectionsImported: number;
  connectionsImported: number;
  favoritesImported: number;
  commentsImported: number;
  mediaAssetsImported: number;
  importedMaps: number;
  skippedProfiles: number;
  skippedAdventures: number;
  skippedSidekicks: number;
  skippedFavorites: number;
  skippedComments: number;
};

const visibilityMap = new Map<string, string>([
  ["Private", "private"],
  ["Sidekicks", "connections"],
  ["Public", "public"]
]);

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

async function readProfiles(client: PoolClient, runId: number): Promise<RawRow<ProfileRaw>[]> {
  const result = await client.query<RawRow<ProfileRaw>>(
    `
      select source_key, payload_json
      from migration_stage.profiles_raw
      where run_id = $1
      order by id
    `,
    [runId]
  );

  return result.rows;
}

async function readAdventures(client: PoolClient, runId: number): Promise<RawRow<AdventureRaw>[]> {
  const result = await client.query<RawRow<AdventureRaw>>(
    `
      select source_key, payload_json
      from migration_stage.adventures_raw
      where run_id = $1
      order by id
    `,
    [runId]
  );

  return result.rows;
}

async function readSidekicks(client: PoolClient, runId: number): Promise<RawRow<SidekickRaw>[]> {
  const result = await client.query<RawRow<SidekickRaw>>(
    `
      select source_key, payload_json
      from migration_stage.sidekicks_raw
      where run_id = $1
      order by id
    `,
    [runId]
  );

  return result.rows;
}

async function readFavorites(client: PoolClient, runId: number): Promise<RawRow<FavoriteRaw>[]> {
  const result = await client.query<RawRow<FavoriteRaw>>(
    `
      select source_key, payload_json
      from migration_stage.favorites_raw
      where run_id = $1
      order by id
    `,
    [runId]
  );

  return result.rows;
}

async function readComments(client: PoolClient, runId: number): Promise<RawRow<CommentRaw>[]> {
  const result = await client.query<RawRow<CommentRaw>>(
    `
      select source_key, payload_json
      from migration_stage.comments_raw
      where run_id = $1
      order by id
    `,
    [runId]
  );

  return result.rows;
}

async function clearWorkRows(client: PoolClient, runId: number) {
  const statements = [
    "delete from migration_work.adventure_comments_work where run_id = $1",
    "delete from migration_work.adventure_favorites_work where run_id = $1",
    "delete from migration_work.connections_work where run_id = $1",
    "delete from migration_work.adventure_rating_projection_work where run_id = $1",
    "delete from migration_work.adventures_work where run_id = $1",
    "delete from migration_work.media_assets_work where run_id = $1",
    "delete from migration_work.profiles_work where run_id = $1",
    "delete from migration_work.users_work where run_id = $1",
    "delete from migration_work.import_maps where run_id = $1 and map_type in ('legacy_username', 'legacy_adventure_id', 'legacy_media_key')",
    "delete from migration_meta.import_audit where run_id = $1 and source_collection in ('profiles', 'adventures', 'sidekicks', 'favorites', 'comments')"
  ];

  for (const statement of statements) {
    await client.query(statement, [runId]);
  }
}

async function ensureRunExists(client: PoolClient, runId: number) {
  const result = await client.query<{ exists: boolean }>(
    "select exists(select 1 from migration_meta.import_runs where id = $1) as exists",
    [runId]
  );

  if (!result.rows[0]?.exists) {
    throw new Error(`Import run ${runId} does not exist.`);
  }
}

async function upsertMediaAsset(
  client: PoolClient,
  runId: number,
  mediaByStorageKey: Map<string, string>,
  summary: TransformSummary,
  seed: MediaSeed
): Promise<string> {
  const existing = mediaByStorageKey.get(seed.storageKey);
  if (existing) {
    return existing;
  }

  await client.query(
    `
      insert into migration_work.media_assets_work (
        run_id,
        media_asset_id,
        owner_user_id,
        storage_key,
        kind,
        moderation_status,
        created_at,
        updated_at
      ) values ($1, $2::uuid, $3::uuid, $4, $5, 'approved', $6::timestamptz, $7::timestamptz)
    `,
    [
      runId,
      seed.mediaAssetId,
      seed.ownerUserId,
      seed.storageKey,
      seed.kind,
      seed.createdAt,
      seed.updatedAt
    ]
  );

  await insertImportMap(client, runId, "legacy_media_key", seed.storageKey, seed.mediaAssetId);
  mediaByStorageKey.set(seed.storageKey, seed.mediaAssetId);
  summary.mediaAssetsImported += 1;
  summary.importedMaps += 1;
  return seed.mediaAssetId;
}

function normalizeVisibility(value: string | null): string {
  return visibilityMap.get(value ?? "") ?? "private";
}

function extractCoordinates(location: AdventureLocation | undefined): {
  longitude: number | null;
  latitude: number | null;
} {
  if (!location || !Array.isArray(location.coordinates) || location.coordinates.length < 2) {
    return { longitude: null, latitude: null };
  }

  const longitude = Number(location.coordinates[0]);
  const latitude = Number(location.coordinates[1]);

  if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) {
    return { longitude: null, latitude: null };
  }

  return { longitude, latitude };
}

async function importProfiles(
  client: PoolClient,
  runId: number,
  rows: RawRow<ProfileRaw>[],
  summary: TransformSummary
): Promise<Map<string, ProfileWorkSeed>> {
  const usersByHandle = new Map<string, ProfileWorkSeed>();
  const candidatesByHandle = new Map<string, ProfileCandidate[]>();

  for (const row of rows) {
    const profile = row.payload_json;
    const handle = nullableString(profile.username);

    if (!handle) {
      summary.skippedProfiles += 1;
      await appendImportAudit(
        client,
        runId,
        "profiles",
        row.source_key,
        "skipped_profile",
        "Profile row is missing username.",
        profile
      );
      continue;
    }

    if (shouldExcludeLegacyProfileHandle(handle)) {
      summary.skippedProfiles += 1;
      await appendImportAudit(
        client,
        runId,
        "profiles",
        row.source_key,
        "excluded_profile",
        excludedLegacyProfileReason,
        profile
      );
      continue;
    }

    const createdAt = coerceTimestamp(profile.createdAt);
    const updatedAt = coerceTimestamp(profile.updatedAt, new Date(createdAt));
    const existing = candidatesByHandle.get(handle) ?? [];
    existing.push({
      row,
      handle,
      createdAt,
      updatedAt
    });
    candidatesByHandle.set(handle, existing);
  }

  for (const [handle, candidates] of candidatesByHandle) {
    candidates.sort((left, right) => {
      const updatedDelta =
        new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime();

      if (updatedDelta !== 0) {
        return updatedDelta;
      }

      return left.row.source_key.localeCompare(right.row.source_key);
    });

    const winner = candidates[0];
    const profile = winner.row.payload_json;
    const userId = stableUuid(`legacy_user:${handle}`);
    const email = nullableString(profile.email)?.toLowerCase() ?? null;

    await client.query(
      `
        insert into migration_work.users_work (
          run_id,
          user_id,
          source_username,
          handle,
          email,
          cognito_subject,
          status,
          created_at,
          updated_at
        ) values ($1, $2::uuid, $3, $4, $5, null, 'active', $6::timestamptz, $7::timestamptz)
      `,
      [runId, userId, handle, handle, email, winner.createdAt, winner.updatedAt]
    );

    await client.query(
      `
        insert into migration_work.profiles_work (
          run_id,
          user_id,
          display_name,
          home_city,
          home_region,
          avatar_storage_key,
          cover_storage_key,
          created_at,
          updated_at
        ) values ($1, $2::uuid, $3, $4, $5, $6, $7, $8::timestamptz, $9::timestamptz)
      `,
      [
        runId,
        userId,
        nullableString(profile.fullName),
        nullableString(profile.city),
        nullableString(profile.state),
        nullableString(profile.profileImage),
        nullableString(profile.backgroundImage),
        winner.createdAt,
        winner.updatedAt
      ]
    );

    await insertImportMap(client, runId, "legacy_username", handle, userId);

    usersByHandle.set(handle, {
      userId,
      handle,
      email,
      createdAt: winner.createdAt,
      updatedAt: winner.updatedAt
    });

    summary.usersImported += 1;
    summary.profilesImported += 1;
    summary.importedMaps += 1;

    for (const duplicate of candidates.slice(1)) {
      summary.skippedProfiles += 1;
      await appendImportAudit(
        client,
        runId,
        "profiles",
        duplicate.row.source_key,
        "skipped_profile",
        "Duplicate legacy username encountered during profile import; kept the most recently updated profile row.",
        duplicate.row.payload_json
      );
    }
  }

  return usersByHandle;
}

async function importProfileMedia(
  client: PoolClient,
  runId: number,
  rows: RawRow<ProfileRaw>[],
  usersByHandle: Map<string, ProfileWorkSeed>,
  mediaByStorageKey: Map<string, string>,
  summary: TransformSummary
) {
  for (const row of rows) {
    const profile = row.payload_json;
    const handle = nullableString(profile.username);
    if (!handle) {
      continue;
    }

    const owner = usersByHandle.get(handle);
    if (!owner) {
      continue;
    }

    const avatarKey = nullableString(profile.profileImage);
    if (avatarKey) {
      await upsertMediaAsset(client, runId, mediaByStorageKey, summary, {
        mediaAssetId: stableUuid(`legacy_media:${avatarKey}`),
        ownerUserId: owner.userId,
        storageKey: avatarKey,
        kind: "profile_avatar",
        createdAt: owner.createdAt,
        updatedAt: owner.updatedAt
      });
    }

    const coverKey = nullableString(profile.backgroundImage);
    if (coverKey) {
      await upsertMediaAsset(client, runId, mediaByStorageKey, summary, {
        mediaAssetId: stableUuid(`legacy_media:${coverKey}`),
        ownerUserId: owner.userId,
        storageKey: coverKey,
        kind: "profile_cover",
        createdAt: owner.createdAt,
        updatedAt: owner.updatedAt
      });
    }
  }
}

async function importAdventures(
  client: PoolClient,
  runId: number,
  rows: RawRow<AdventureRaw>[],
  usersByHandle: Map<string, ProfileWorkSeed>,
  mediaByStorageKey: Map<string, string>,
  summary: TransformSummary
): Promise<Map<string, AdventureWorkSeed>> {
  const adventuresByLegacyId = new Map<string, AdventureWorkSeed>();

  for (const row of rows) {
    const adventure = row.payload_json;
    const legacyAdventureId = nullableString(adventure._id) ?? row.source_key;
    const authorHandle = nullableString(adventure.author);

    if (!authorHandle) {
      summary.skippedAdventures += 1;
      await appendImportAudit(
        client,
        runId,
        "adventures",
        legacyAdventureId,
        "skipped_adventure",
        "Adventure row is missing author username.",
        adventure
      );
      continue;
    }

    const author = usersByHandle.get(authorHandle);
    if (!author) {
      summary.skippedAdventures += 1;
      await appendImportAudit(
        client,
        runId,
        "adventures",
        legacyAdventureId,
        "skipped_adventure",
        "Adventure author could not be resolved to an imported user.",
        adventure
      );
      continue;
    }

    const createdAt = coerceTimestamp(adventure.createdAt, new Date(author.createdAt));
    const updatedAt = coerceTimestamp(adventure.updatedAt, new Date(createdAt));
    const adventureId = stableUuid(`legacy_adventure:${legacyAdventureId}`);
    const { longitude, latitude } = extractCoordinates(adventure.location);
    const description = nullableString(adventure.desc);
    const defaultImageKey = nullableString(adventure.defaultImage);
    const sourceCategory = nullableString(adventure.category);
    const normalizedCategory = normalizeAdventureCategorySlug(sourceCategory);

    if (sourceCategory && !normalizedCategory) {
      summary.skippedAdventures += 1;
      await appendImportAudit(
        client,
        runId,
        "adventures",
        legacyAdventureId,
        "quarantined_adventure",
        `Adventure category "${sourceCategory}" is not part of the locked category taxonomy.`,
        adventure
      );
      continue;
    }

    await client.query(
      `
        insert into migration_work.adventures_work (
          run_id,
          adventure_id,
          legacy_adventure_id,
          author_user_id,
          title,
          description,
          category_slug,
          visibility,
          status,
          longitude,
          latitude,
          default_image_key,
          legacy_rating_sum,
          legacy_rating_count,
          created_at,
          updated_at,
          published_at
        ) values (
          $1,
          $2::uuid,
          $3,
          $4::uuid,
          $5,
          $6,
          $7,
          $8,
          'published',
          $9,
          $10,
          $11,
          $12,
          $13,
          $14::timestamptz,
          $15::timestamptz,
          $16::timestamptz
        )
      `,
      [
        runId,
        adventureId,
        legacyAdventureId,
        author.userId,
        nullableString(adventure.name) ?? "Untitled Adventure",
        description,
        normalizedCategory,
        normalizeVisibility(nullableString(adventure.access)),
        longitude,
        latitude,
        defaultImageKey,
        Number(adventure.rating ?? 0),
        Number(adventure.ratingCount ?? 0),
        createdAt,
        updatedAt,
        createdAt
      ]
    );

    await client.query(
      `
        insert into migration_work.adventure_rating_projection_work (
          run_id,
          adventure_id,
          legacy_adventure_id,
          legacy_rating_sum,
          legacy_rating_count,
          average_rating
        ) values ($1, $2::uuid, $3, $4, $5, $6)
      `,
      [
        runId,
        adventureId,
        legacyAdventureId,
        Number(adventure.rating ?? 0),
        Number(adventure.ratingCount ?? 0),
        Number(adventure.ratingCount ?? 0) > 0
          ? Number(adventure.rating ?? 0) / Number(adventure.ratingCount ?? 0)
          : 0
      ]
    );

    await insertImportMap(client, runId, "legacy_adventure_id", legacyAdventureId, adventureId);

    if (defaultImageKey) {
      await upsertMediaAsset(client, runId, mediaByStorageKey, summary, {
        mediaAssetId: stableUuid(`legacy_media:${defaultImageKey}`),
        ownerUserId: author.userId,
        storageKey: defaultImageKey,
        kind: "adventure_image",
        createdAt,
        updatedAt
      });
    }

    summary.adventuresImported += 1;
    summary.ratingProjectionsImported += 1;
    summary.importedMaps += 1;
    adventuresByLegacyId.set(legacyAdventureId, { adventureId });
  }

  return adventuresByLegacyId;
}

async function importConnections(
  client: PoolClient,
  runId: number,
  rows: RawRow<SidekickRaw>[],
  usersByHandle: Map<string, ProfileWorkSeed>,
  summary: TransformSummary
) {
  const candidatesByPair = new Map<string, ConnectionCandidate[]>();

  for (const row of rows) {
    const sidekick = row.payload_json;
    const initiatorHandle = nullableString(sidekick.username);
    const partnerHandle = nullableString(sidekick.sidekickName);

    if (!initiatorHandle || !partnerHandle) {
      summary.skippedSidekicks += 1;
      await appendImportAudit(
        client,
        runId,
        "sidekicks",
        row.source_key,
        "skipped_sidekick",
        "Sidekick row is missing one or both usernames.",
        sidekick
      );
      continue;
    }

    if (initiatorHandle === partnerHandle) {
      summary.skippedSidekicks += 1;
      await appendImportAudit(
        client,
        runId,
        "sidekicks",
        row.source_key,
        "skipped_sidekick",
        "Sidekick row points to the same user on both sides.",
        sidekick
      );
      continue;
    }

    const initiator = usersByHandle.get(initiatorHandle);
    const partner = usersByHandle.get(partnerHandle);

    if (!initiator || !partner) {
      summary.skippedSidekicks += 1;
      await appendImportAudit(
        client,
        runId,
        "sidekicks",
        row.source_key,
        "skipped_sidekick",
        "Sidekick row could not be resolved to two imported users.",
        sidekick
      );
      continue;
    }

    const createdAt = coerceTimestamp(sidekick.createdAt, new Date(initiator.createdAt));
    const updatedAt = coerceTimestamp(sidekick.updatedAt, new Date(createdAt));
    const pairKey = [initiatorHandle, partnerHandle].sort().join("::");
    const existing = candidatesByPair.get(pairKey) ?? [];
    existing.push({
      row,
      initiatorHandle,
      partnerHandle,
      createdAt,
      updatedAt
    });
    candidatesByPair.set(pairKey, existing);
  }

  for (const [pairKey, candidates] of candidatesByPair) {
    candidates.sort((left, right) => {
      const createdDelta =
        new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime();

      if (createdDelta !== 0) {
        return createdDelta;
      }

      return left.row.source_key.localeCompare(right.row.source_key);
    });

    const first = candidates[0];
    const lowHandle = [first.initiatorHandle, first.partnerHandle].sort()[0];
    const highHandle = [first.initiatorHandle, first.partnerHandle].sort()[1];
    const lowUser = usersByHandle.get(lowHandle);
    const highUser = usersByHandle.get(highHandle);
    const initiator = usersByHandle.get(first.initiatorHandle);

    if (!lowUser || !highUser || !initiator) {
      throw new Error(`Resolved connection pair ${pairKey} lost one of its user mappings.`);
    }

    const latestUpdatedAt = candidates
      .map((candidate) => candidate.updatedAt)
      .sort((left, right) => new Date(right).getTime() - new Date(left).getTime())[0];

    await client.query(
      `
        insert into migration_work.connections_work (
          run_id,
          connection_id,
          user_id_low,
          user_id_high,
          initiated_by_user_id,
          status,
          requested_at,
          responded_at,
          updated_at,
          source_username,
          source_sidekick_name
        ) values (
          $1,
          $2::uuid,
          $3::uuid,
          $4::uuid,
          $5::uuid,
          'accepted',
          $6::timestamptz,
          $7::timestamptz,
          $8::timestamptz,
          $9,
          $10
        )
      `,
      [
        runId,
        stableUuid(`legacy_connection:${lowHandle}:${highHandle}`),
        lowUser.userId,
        highUser.userId,
        initiator.userId,
        first.createdAt,
        latestUpdatedAt,
        latestUpdatedAt,
        first.initiatorHandle,
        first.partnerHandle
      ]
    );

    summary.connectionsImported += 1;

    for (const duplicate of candidates.slice(1)) {
      summary.skippedSidekicks += 1;
      await appendImportAudit(
        client,
        runId,
        "sidekicks",
        duplicate.row.source_key,
        "skipped_sidekick",
        "Duplicate sidekick pair collapsed into a canonical accepted connection.",
        duplicate.row.payload_json
      );
    }
  }
}

async function importFavorites(
  client: PoolClient,
  runId: number,
  rows: RawRow<FavoriteRaw>[],
  usersByHandle: Map<string, ProfileWorkSeed>,
  adventuresByLegacyId: Map<string, AdventureWorkSeed>,
  summary: TransformSummary
) {
  const favoriteCandidates = new Map<string, { row: RawRow<FavoriteRaw>; createdAt: string }[]>();

  for (const row of rows) {
    const favorite = row.payload_json;
    const handle = nullableString(favorite.username);
    const legacyAdventureId = nullableString(favorite.adventureID);

    if (!handle || !legacyAdventureId) {
      summary.skippedFavorites += 1;
      await appendImportAudit(
        client,
        runId,
        "favorites",
        row.source_key,
        "skipped_favorite",
        "Favorite row is missing username or adventure ID.",
        favorite
      );
      continue;
    }

    const user = usersByHandle.get(handle);
    const adventure = adventuresByLegacyId.get(legacyAdventureId);

    if (!user || !adventure) {
      summary.skippedFavorites += 1;
      await appendImportAudit(
        client,
        runId,
        "favorites",
        row.source_key,
        "skipped_favorite",
        "Favorite row could not be resolved to an imported user and adventure.",
        favorite
      );
      continue;
    }

    const favoriteKey = `${user.userId}::${adventure.adventureId}`;
    const existing = favoriteCandidates.get(favoriteKey) ?? [];
    existing.push({
      row,
      createdAt: coerceTimestamp(favorite.createdAt, new Date(user.createdAt))
    });
    favoriteCandidates.set(favoriteKey, existing);
  }

  for (const [favoriteKey, candidates] of favoriteCandidates) {
    candidates.sort((left, right) => {
      const createdDelta =
        new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime();

      if (createdDelta !== 0) {
        return createdDelta;
      }

      return left.row.source_key.localeCompare(right.row.source_key);
    });

    const [userId, adventureId] = favoriteKey.split("::");
    await client.query(
      `
        insert into migration_work.adventure_favorites_work (
          run_id,
          user_id,
          adventure_id,
          source_username,
          source_adventure_id,
          created_at
        ) values ($1, $2::uuid, $3::uuid, $4, $5, $6::timestamptz)
      `,
      [
        runId,
        userId,
        adventureId,
        nullableString(candidates[0].row.payload_json.username),
        nullableString(candidates[0].row.payload_json.adventureID),
        candidates[0].createdAt
      ]
    );

    summary.favoritesImported += 1;

    for (const duplicate of candidates.slice(1)) {
      summary.skippedFavorites += 1;
      await appendImportAudit(
        client,
        runId,
        "favorites",
        duplicate.row.source_key,
        "skipped_favorite",
        "Duplicate favorite pair collapsed into one imported favorite row.",
        duplicate.row.payload_json
      );
    }
  }
}

async function importComments(
  client: PoolClient,
  runId: number,
  rows: RawRow<CommentRaw>[],
  usersByHandle: Map<string, ProfileWorkSeed>,
  adventuresByLegacyId: Map<string, AdventureWorkSeed>,
  summary: TransformSummary
) {
  for (const row of rows) {
    const comment = row.payload_json;
    const handle = nullableString(comment.username);
    const legacyAdventureId = nullableString(comment.adventureID);
    const body = nullableString(comment.text);

    if (!handle || !legacyAdventureId || !body) {
      summary.skippedComments += 1;
      await appendImportAudit(
        client,
        runId,
        "comments",
        row.source_key,
        "skipped_comment",
        "Comment row is missing username, adventure ID, or body text.",
        comment
      );
      continue;
    }

    const author = usersByHandle.get(handle);
    const adventure = adventuresByLegacyId.get(legacyAdventureId);

    if (!author || !adventure) {
      summary.skippedComments += 1;
      await appendImportAudit(
        client,
        runId,
        "comments",
        row.source_key,
        "skipped_comment",
        "Comment row could not be resolved to an imported user and adventure.",
        comment
      );
      continue;
    }

    const createdAt = coerceTimestamp(comment.createdAt, new Date(author.createdAt));
    const updatedAt = coerceTimestamp(comment.updatedAt, new Date(createdAt));

    await client.query(
      `
        insert into migration_work.adventure_comments_work (
          run_id,
          comment_id,
          adventure_id,
          author_user_id,
          source_comment_id,
          source_username,
          source_adventure_id,
          body,
          created_at,
          updated_at
        ) values (
          $1,
          $2::uuid,
          $3::uuid,
          $4::uuid,
          $5,
          $6,
          $7,
          $8,
          $9::timestamptz,
          $10::timestamptz
        )
      `,
      [
        runId,
        stableUuid(`legacy_comment:${row.source_key}`),
        adventure.adventureId,
        author.userId,
        nullableString(comment._id) ?? row.source_key,
        handle,
        legacyAdventureId,
        body,
        createdAt,
        updatedAt
      ]
    );

    summary.commentsImported += 1;
  }
}

async function writeReport(reportPath: string, summary: TransformSummary) {
  const absoluteReportPath = path.resolve(process.cwd(), reportPath);
  await mkdir(path.dirname(absoluteReportPath), { recursive: true });
  await writeFile(absoluteReportPath, JSON.stringify(summary, null, 2) + "\n", "utf8");
}

async function run() {
  const options = parseArgs(process.argv.slice(2));

  const summary = await db.withTransaction<TransformSummary>(async (client) => {
    await ensureRunExists(client, options.runId);
    await clearWorkRows(client, options.runId);

    const profileRows = await readProfiles(client, options.runId);
    const adventureRows = await readAdventures(client, options.runId);
    const sidekickRows = await readSidekicks(client, options.runId);
    const favoriteRows = await readFavorites(client, options.runId);
    const commentRows = await readComments(client, options.runId);

    const transformSummary: TransformSummary = {
      runId: options.runId,
      usersImported: 0,
      profilesImported: 0,
      adventuresImported: 0,
      ratingProjectionsImported: 0,
      connectionsImported: 0,
      favoritesImported: 0,
      commentsImported: 0,
      mediaAssetsImported: 0,
      importedMaps: 0,
      skippedProfiles: 0,
      skippedAdventures: 0,
      skippedSidekicks: 0,
      skippedFavorites: 0,
      skippedComments: 0
    };

    const usersByHandle = await importProfiles(client, options.runId, profileRows, transformSummary);
    const mediaByStorageKey = new Map<string, string>();
    await importProfileMedia(
      client,
      options.runId,
      profileRows,
      usersByHandle,
      mediaByStorageKey,
      transformSummary
    );
    const adventuresByLegacyId = await importAdventures(
      client,
      options.runId,
      adventureRows,
      usersByHandle,
      mediaByStorageKey,
      transformSummary
    );
    await importConnections(
      client,
      options.runId,
      sidekickRows,
      usersByHandle,
      transformSummary
    );
    await importFavorites(
      client,
      options.runId,
      favoriteRows,
      usersByHandle,
      adventuresByLegacyId,
      transformSummary
    );
    await importComments(
      client,
      options.runId,
      commentRows,
      usersByHandle,
      adventuresByLegacyId,
      transformSummary
    );

    return transformSummary;
  });

  if (options.reportPath) {
    await writeReport(options.reportPath, summary);
  }

  console.log(JSON.stringify(summary, null, 2));
}

run()
  .catch((error: unknown) => {
    console.error("Stage-to-work transform failed.", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.close();
  });
