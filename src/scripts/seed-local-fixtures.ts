import type { PoolClient } from "pg";
import { fileURLToPath } from "node:url";

import { db } from "../db/client.js";
import {
  listSeededLocalFixtures,
  listSeededLocalHandles,
  listSeededLocalSubjects,
  localFixtureContent,
  localIdentityFixtures,
  makeLocalFixtureId
} from "../features/auth/local-fixtures.js";
import { createLocalPostgresBackup } from "./backup-local-postgres.js";

type CliOptions = {
  backupDir?: string;
};

type SeedSummary = {
  backupPath: string;
  managedHandles: string[];
  managedSubjects: string[];
  publicAdventureId: string;
  connectionsAdventureId: string;
  profileHandle: string;
};

const fixtureAuthor = localIdentityFixtures.fixture_author.seededUser!;
const connectedViewer = localIdentityFixtures.connected_viewer.seededUser!;
const nonConnectedViewer = localIdentityFixtures.non_connected_viewer.seededUser!;

if (!fixtureAuthor || !connectedViewer || !nonConnectedViewer) {
  throw new Error("Seeded local identity fixtures are incomplete.");
}

function parseArgs(argv: string[]): CliOptions {
  let backupDir: string | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--backup-dir") {
      backupDir = argv[index + 1];
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return { backupDir };
}

function orderedConnectionPair(userIdA: string, userIdB: string) {
  return userIdA < userIdB
    ? { userIdLow: userIdA, userIdHigh: userIdB }
    : { userIdLow: userIdB, userIdHigh: userIdA };
}

async function deleteManagedFixtures(client: PoolClient) {
  await client.query(
    `
      delete from public.users
      where cognito_subject = any($1::text[])
         or handle = any($2::text[])
    `,
    [listSeededLocalSubjects(), listSeededLocalHandles()]
  );
}

async function insertManagedUsers(client: PoolClient) {
  for (const fixture of listSeededLocalFixtures()) {
    if (!fixture.seededUser) {
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
          'rebuild_signup',
          'active',
          $5::timestamptz,
          $6::timestamptz,
          null
        )
      `,
      [
        fixture.seededUser.id,
        fixture.identity.sub,
        fixture.seededUser.handle,
        fixture.seededUser.email,
        "2026-03-01T00:00:00.000Z",
        "2026-03-10T00:00:00.000Z"
      ]
    );

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
          null,
          null,
          $6::timestamptz,
          $7::timestamptz
        )
      `,
      [
        fixture.seededUser.id,
        fixture.seededUser.displayName,
        fixture.seededUser.bio,
        fixture.seededUser.homeCity,
        fixture.seededUser.homeRegion,
        "2026-03-01T00:00:00.000Z",
        "2026-03-10T00:00:00.000Z"
      ]
    );
  }
}

async function insertConnections(client: PoolClient) {
  const pair = orderedConnectionPair(fixtureAuthor.id, connectedViewer.id);

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
        'accepted',
        $5::timestamptz,
        $6::timestamptz,
        $7::timestamptz
      )
    `,
    [
      makeLocalFixtureId("connection:author-connected-viewer"),
      pair.userIdLow,
      pair.userIdHigh,
      connectedViewer.id,
      "2026-03-04T00:00:00.000Z",
      "2026-03-04T01:00:00.000Z",
      "2026-03-04T01:00:00.000Z"
    ]
  );
}

async function insertAdventures(client: PoolClient) {
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
        'public',
        'published',
        ST_SetSRID(ST_MakePoint($7, $8), 4326)::geography,
        $9,
        $10::timestamptz,
        $11::timestamptz,
        $12::timestamptz,
        null
      )
    `,
    [
      localFixtureContent.publicAdventureId,
      fixtureAuthor.id,
      "Fixture Falls",
      "Seeded public adventure for local auth testing.",
      "This public adventure should be visible to any authenticated fixture user.",
      "water_spots",
      -118.4512,
      34.1201,
      "Fixture Falls Trailhead",
      "2026-03-02T00:00:00.000Z",
      "2026-03-03T00:00:00.000Z",
      "2026-03-02T12:00:00.000Z"
    ]
  );

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
        'connections',
        'published',
        ST_SetSRID(ST_MakePoint($7, $8), 4326)::geography,
        $9,
        $10::timestamptz,
        $11::timestamptz,
        $12::timestamptz,
        null
      )
    `,
    [
      localFixtureContent.connectionsAdventureId,
      fixtureAuthor.id,
      "Connected Canyon",
      "Seeded connections-only adventure for viewer access tests.",
      "Only accepted connections should see this seeded adventure.",
      "viewpoints",
      -118.4411,
      34.131,
      "Connected Canyon Ridge",
      "2026-03-05T00:00:00.000Z",
      "2026-03-06T00:00:00.000Z",
      "2026-03-05T12:00:00.000Z"
    ]
  );
}

async function insertEngagement(client: PoolClient) {
  await client.query(
    `
      insert into public.adventure_favorites (user_id, adventure_id, created_at)
      values ($1::uuid, $2::uuid, $3::timestamptz)
    `,
    [connectedViewer.id, localFixtureContent.publicAdventureId, "2026-03-07T00:00:00.000Z"]
  );

  await client.query(
    `
      insert into public.adventure_ratings (user_id, adventure_id, score, created_at, updated_at)
      values
        ($1::uuid, $3::uuid, 5, $4::timestamptz, $4::timestamptz),
        ($2::uuid, $3::uuid, 4, $4::timestamptz, $4::timestamptz)
    `,
    [
      connectedViewer.id,
      nonConnectedViewer.id,
      localFixtureContent.publicAdventureId,
      "2026-03-07T01:00:00.000Z"
    ]
  );

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
      ) values
        ($1::uuid, $3::uuid, $4::uuid, $5, $6::timestamptz, $6::timestamptz, null),
        ($2::uuid, $7::uuid, $8::uuid, $9, $10::timestamptz, $10::timestamptz, null)
    `,
    [
      makeLocalFixtureId("comment:public-connected-viewer"),
      makeLocalFixtureId("comment:connections-author"),
      localFixtureContent.publicAdventureId,
      connectedViewer.id,
      "Saving this for a weekend revisit.",
      "2026-03-07T02:00:00.000Z",
      localFixtureContent.connectionsAdventureId,
      fixtureAuthor.id,
      "Connections can meet here just before sunset.",
      "2026-03-08T02:00:00.000Z"
    ]
  );

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
      ) values
        ($1::uuid, 1, 1, 2, 9, 4.5, $3::timestamptz),
        ($2::uuid, 0, 1, 0, 0, 0, $3::timestamptz)
    `,
    [
      localFixtureContent.publicAdventureId,
      localFixtureContent.connectionsAdventureId,
      "2026-03-08T03:00:00.000Z"
    ]
  );
}

export async function seedLocalFixtures(options: CliOptions = {}): Promise<SeedSummary> {
  const backupPath = await createLocalPostgresBackup({ outputDir: options.backupDir });

  await db.withTransaction(async (client) => {
    await deleteManagedFixtures(client);
    await insertManagedUsers(client);
    await insertConnections(client);
    await insertAdventures(client);
    await insertEngagement(client);
  });

  return {
    backupPath,
    managedHandles: listSeededLocalHandles(),
    managedSubjects: listSeededLocalSubjects(),
    publicAdventureId: localFixtureContent.publicAdventureId,
    connectionsAdventureId: localFixtureContent.connectionsAdventureId,
    profileHandle: localFixtureContent.profileHandle
  };
}

function isDirectExecution(): boolean {
  const entry = process.argv[1];
  return entry ? fileURLToPath(import.meta.url) === entry : false;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const summary = await seedLocalFixtures(options);
  console.log(JSON.stringify(summary, null, 2));
}

if (isDirectExecution()) {
  void main()
    .catch((error: unknown) => {
      console.error("Local fixture seed failed.", error);
      process.exitCode = 1;
    })
    .finally(async () => {
      await db.close();
    });
}
