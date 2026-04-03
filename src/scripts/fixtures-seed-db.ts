import { AdminGetUserCommand } from "@aws-sdk/client-cognito-identity-provider";
import type { PoolClient } from "pg";

import { env } from "../config/env.js";
import { db } from "../db/client.js";
import {
  fixtureAdventureId,
  fixtureCommentId,
  fixtureConnectionId,
  fixtureMediaAssetId,
  fixtureUserId,
  loadFixturePack,
  type FixturePack
} from "../features/fixtures/manifest.js";
import { createCognitoIdentityProviderClient } from "../features/auth/cognito.js";

type CliOptions = {
  pack: string;
};

type Stats = {
  favoriteCount: number;
  commentCount: number;
  ratingCount: number;
  ratingSum: number;
  averageRating: number;
};

function parseArgs(argv: string[]): CliOptions {
  let pack = "test-core";

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--pack") {
      pack = argv[index + 1] ?? pack;
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return { pack };
}

function getAttribute(attributes: { Name?: string; Value?: string }[] | undefined, name: string): string | null {
  const value = attributes?.find((attribute) => attribute.Name === name)?.Value;
  return value?.trim() || null;
}

async function resolveCognitoSubject(username: string): Promise<string> {
  if (!env.COGNITO_USER_POOL_ID) {
    throw new Error("COGNITO_USER_POOL_ID is required to resolve Cognito-backed fixture personas.");
  }

  const client = createCognitoIdentityProviderClient();
  const response = await client.send(
    new AdminGetUserCommand({
      UserPoolId: env.COGNITO_USER_POOL_ID,
      Username: username
    })
  );

  const sub = getAttribute(response.UserAttributes, "sub");
  if (!sub) {
    throw new Error(`Fixture persona "${username}" exists in Cognito but is missing a sub.`);
  }

  return sub;
}

async function resolvePersonaSubjects(pack: FixturePack): Promise<Map<string, string>> {
  const subjects = new Map<string, string>();

  for (const persona of pack.personas) {
    if (persona.authMode === "test_jwt") {
      subjects.set(persona.key, persona.testJwtSub!);
      continue;
    }

    subjects.set(persona.key, await resolveCognitoSubject(persona.username));
  }

  return subjects;
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

async function seedUsers(client: PoolClient, pack: FixturePack, subjects: Map<string, string>) {
  for (const persona of pack.personas) {
    if (!persona.user) {
      continue;
    }

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
        ) values (
          $1::uuid,
          $2,
          $3,
          $4,
          $5,
          'active',
          $6::timestamptz,
          $7::timestamptz,
          null
        )
      `,
      [
        fixtureUserId(pack, persona.key),
        subjects.get(persona.key) ?? null,
        persona.user.handle,
        persona.email,
        persona.user.accountOrigin,
        persona.user.createdAt,
        persona.user.updatedAt
      ]
    );
  }
}

async function seedMediaAssets(client: PoolClient, pack: FixturePack) {
  for (const asset of pack.mediaAssets) {
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
        ) values (
          $1::uuid,
          $2::uuid,
          $3,
          $4,
          'approved',
          $5::timestamptz,
          $6::timestamptz,
          null
        )
      `,
      [
        fixtureMediaAssetId(pack, asset.key),
        fixtureUserId(pack, asset.ownerPersonaKey),
        asset.storageKey,
        asset.kind,
        asset.createdAt,
        asset.updatedAt
      ]
    );
  }
}

async function seedProfiles(client: PoolClient, pack: FixturePack) {
  for (const persona of pack.personas) {
    if (!persona.user) {
      continue;
    }

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
        ) values (
          $1::uuid,
          $2,
          $3,
          $4,
          $5,
          $6::uuid,
          $7::uuid,
          $8::timestamptz,
          $9::timestamptz
        )
      `,
      [
        fixtureUserId(pack, persona.key),
        persona.user.displayName,
        persona.user.bio,
        persona.user.homeCity,
        persona.user.homeRegion,
        persona.user.avatarMediaKey ? fixtureMediaAssetId(pack, persona.user.avatarMediaKey) : null,
        persona.user.coverMediaKey ? fixtureMediaAssetId(pack, persona.user.coverMediaKey) : null,
        persona.user.createdAt,
        persona.user.updatedAt
      ]
    );
  }
}

function orderedPair(userIdA: string, userIdB: string) {
  return userIdA < userIdB
    ? { low: userIdA, high: userIdB }
    : { low: userIdB, high: userIdA };
}

async function seedConnections(client: PoolClient, pack: FixturePack) {
  for (const connection of pack.connections) {
    const pair = orderedPair(fixtureUserId(pack, connection.userKeyA), fixtureUserId(pack, connection.userKeyB));
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
        ) values (
          $1::uuid,
          $2::uuid,
          $3::uuid,
          $4::uuid,
          $5::public.connection_status,
          $6::timestamptz,
          $7::timestamptz,
          $8::timestamptz
        )
      `,
      [
        fixtureConnectionId(pack, connection.key),
        pair.low,
        pair.high,
        fixtureUserId(pack, connection.initiatedByPersonaKey),
        connection.status,
        connection.requestedAt,
        connection.respondedAt,
        connection.updatedAt
      ]
    );
  }
}

async function seedAdventures(client: PoolClient, pack: FixturePack) {
  for (const adventure of pack.adventures) {
    const hasPoint =
      typeof adventure.longitude === "number" && typeof adventure.latitude === "number";

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
        ) values (
          $1::uuid,
          $2::uuid,
          $3,
          $4,
          $5,
          $6,
          $7::public.adventure_visibility,
          $8::public.adventure_status,
          case
            when $9::double precision is null or $10::double precision is null then null
            else ST_SetSRID(ST_MakePoint($9, $10), 4326)::geography
          end,
          $11,
          $12::timestamptz,
          $13::timestamptz,
          $14::timestamptz,
          null
        )
      `,
      [
        fixtureAdventureId(pack, adventure.key),
        fixtureUserId(pack, adventure.authorPersonaKey),
        adventure.title,
        adventure.summary,
        adventure.body,
        adventure.categorySlug,
        adventure.visibility,
        adventure.status,
        hasPoint ? adventure.longitude : null,
        hasPoint ? adventure.latitude : null,
        adventure.placeLabel ?? null,
        adventure.createdAt,
        adventure.updatedAt,
        adventure.publishedAt ?? adventure.createdAt
      ]
    );

    if (adventure.primaryMediaKey) {
      await client.query(
        `
          insert into public.adventure_media (
            adventure_id,
            media_asset_id,
            sort_order,
            is_primary,
            created_at
          ) values ($1::uuid, $2::uuid, 0, true, $3::timestamptz)
        `,
        [
          fixtureAdventureId(pack, adventure.key),
          fixtureMediaAssetId(pack, adventure.primaryMediaKey),
          adventure.createdAt
        ]
      );
    }
  }
}

async function seedFavorites(client: PoolClient, pack: FixturePack) {
  for (const favorite of pack.favorites) {
    await client.query(
      `
        insert into public.adventure_favorites (user_id, adventure_id, created_at)
        values ($1::uuid, $2::uuid, $3::timestamptz)
      `,
      [
        fixtureUserId(pack, favorite.personaKey),
        fixtureAdventureId(pack, favorite.adventureKey),
        favorite.createdAt
      ]
    );
  }
}

async function seedRatings(client: PoolClient, pack: FixturePack) {
  for (const rating of pack.ratings) {
    await client.query(
      `
        insert into public.adventure_ratings (user_id, adventure_id, score, created_at, updated_at)
        values ($1::uuid, $2::uuid, $3, $4::timestamptz, $5::timestamptz)
      `,
      [
        fixtureUserId(pack, rating.personaKey),
        fixtureAdventureId(pack, rating.adventureKey),
        rating.score,
        rating.createdAt,
        rating.updatedAt
      ]
    );
  }
}

async function seedComments(client: PoolClient, pack: FixturePack) {
  for (const comment of pack.comments) {
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
        ) values ($1::uuid, $2::uuid, $3::uuid, $4, $5::timestamptz, $6::timestamptz, null)
      `,
      [
        fixtureCommentId(pack, comment.key),
        fixtureAdventureId(pack, comment.adventureKey),
        fixtureUserId(pack, comment.authorPersonaKey),
        comment.body,
        comment.createdAt,
        comment.updatedAt
      ]
    );
  }
}

function buildStats(pack: FixturePack): Map<string, Stats> {
  const stats = new Map<string, Stats>();

  for (const adventure of pack.adventures) {
    stats.set(adventure.key, {
      favoriteCount: 0,
      commentCount: 0,
      ratingCount: 0,
      ratingSum: 0,
      averageRating: 0
    });
  }

  for (const favorite of pack.favorites) {
    stats.get(favorite.adventureKey)!.favoriteCount += 1;
  }

  for (const comment of pack.comments) {
    stats.get(comment.adventureKey)!.commentCount += 1;
  }

  for (const rating of pack.ratings) {
    const entry = stats.get(rating.adventureKey)!;
    entry.ratingCount += 1;
    entry.ratingSum += rating.score;
  }

  for (const entry of stats.values()) {
    entry.averageRating = entry.ratingCount > 0 ? entry.ratingSum / entry.ratingCount : 0;
  }

  return stats;
}

async function seedStats(client: PoolClient, pack: FixturePack) {
  const stats = buildStats(pack);

  for (const adventure of pack.adventures) {
    const entry = stats.get(adventure.key)!;
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
        ) values ($1::uuid, $2, $3, $4, $5, $6, $7::timestamptz)
      `,
      [
        fixtureAdventureId(pack, adventure.key),
        entry.favoriteCount,
        entry.commentCount,
        entry.ratingCount,
        entry.ratingSum,
        entry.averageRating,
        adventure.updatedAt
      ]
    );
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const pack = await loadFixturePack(options.pack);

  if (pack.targetDatabase !== env.POSTGRES_DB) {
    throw new Error(
      `Fixture pack "${pack.pack}" targets database "${pack.targetDatabase}", but POSTGRES_DB is "${env.POSTGRES_DB}".`
    );
  }

  const subjects = await resolvePersonaSubjects(pack);

  await db.withTransaction(async (client) => {
    await clearPublicTables(client);
    await seedUsers(client, pack, subjects);
    await seedMediaAssets(client, pack);
    await seedProfiles(client, pack);
    await seedConnections(client, pack);
    await seedAdventures(client, pack);
    await seedFavorites(client, pack);
    await seedRatings(client, pack);
    await seedComments(client, pack);
    await seedStats(client, pack);
  });

  console.log(
    JSON.stringify(
      {
        pack: pack.pack,
        database: env.POSTGRES_DB,
        seeded: true
      },
      null,
      2
    )
  );
}

void main()
  .catch((error: unknown) => {
    console.error("Fixture DB seed failed.", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.close();
  });
