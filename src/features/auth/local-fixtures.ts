import { createHash } from "node:crypto";

import type { AuthenticatedIdentity } from "./service.js";

function stableUuid(seed: string): string {
  const digest = createHash("sha1").update(seed).digest();
  const bytes = Buffer.from(digest.subarray(0, 16));

  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = bytes.toString("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32)
  ].join("-");
}

export const LOCAL_IDENTITY_TOKEN_PREFIX = "local:";
export const LOCAL_FIXTURE_DEFAULT_HANDLE = "fixture_new_handle";

export type LocalIdentityFixture = {
  key: string;
  token: string;
  identity: AuthenticatedIdentity;
  seededUser:
    | {
        id: string;
        handle: string;
        email: string;
        displayName: string;
        bio: string;
        homeCity: string;
        homeRegion: string;
      }
    | null;
};

function makeFixture(
  key: string,
  input: Omit<LocalIdentityFixture, "key" | "token">
): LocalIdentityFixture {
  return {
    key,
    token: `${LOCAL_IDENTITY_TOKEN_PREFIX}${key}`,
    ...input
  };
}

export const localIdentityFixtures = {
  fixture_author: makeFixture("fixture_author", {
    identity: {
      sub: "local-sub-fixture-author",
      username: "fixture_author",
      email: "fixture.author@hidden-adventures.local",
      emailVerified: true,
      tokenUse: "id"
    },
    seededUser: {
      id: stableUuid("local-fixture:user:author"),
      handle: "fixture_author",
      email: "fixture.author@hidden-adventures.local",
      displayName: "Fixture Author",
      bio: "Seeded local author for authenticated API testing.",
      homeCity: "Los Angeles",
      homeRegion: "CA"
    }
  }),
  connected_viewer: makeFixture("connected_viewer", {
    identity: {
      sub: "local-sub-connected-viewer",
      username: "connected_viewer",
      email: "fixture.connected@hidden-adventures.local",
      emailVerified: true,
      tokenUse: "id"
    },
    seededUser: {
      id: stableUuid("local-fixture:user:connected-viewer"),
      handle: "connected_viewer",
      email: "fixture.connected@hidden-adventures.local",
      displayName: "Connected Viewer",
      bio: "Seeded local viewer with an accepted connection.",
      homeCity: "Pasadena",
      homeRegion: "CA"
    }
  }),
  non_connected_viewer: makeFixture("non_connected_viewer", {
    identity: {
      sub: "local-sub-non-connected-viewer",
      username: "non_connected_viewer",
      email: "fixture.unconnected@hidden-adventures.local",
      emailVerified: true,
      tokenUse: "id"
    },
    seededUser: {
      id: stableUuid("local-fixture:user:non-connected-viewer"),
      handle: "non_connected_viewer",
      email: "fixture.unconnected@hidden-adventures.local",
      displayName: "Non Connected Viewer",
      bio: "Seeded local viewer with no accepted connection to the author.",
      homeCity: "Burbank",
      homeRegion: "CA"
    }
  }),
  new_user: makeFixture("new_user", {
    identity: {
      sub: "local-sub-new-user",
      username: "new_user",
      email: "fixture.new@hidden-adventures.local",
      emailVerified: true,
      tokenUse: "id"
    },
    seededUser: null
  })
} as const;

export type LocalIdentityFixtureKey = keyof typeof localIdentityFixtures;

export const localFixtureContent = {
  profileHandle: localIdentityFixtures.fixture_author.seededUser?.handle ?? "fixture_author",
  publicAdventureId: stableUuid("local-fixture:adventure:public"),
  connectionsAdventureId: stableUuid("local-fixture:adventure:connections")
} as const;

export function getLocalIdentityFixture(key: string): LocalIdentityFixture | null {
  return localIdentityFixtures[key as LocalIdentityFixtureKey] ?? null;
}

export function listSeededLocalFixtures(): LocalIdentityFixture[] {
  return Object.values(localIdentityFixtures);
}

export function listSeededLocalHandles(): string[] {
  return [
    ...Object.values(localIdentityFixtures)
      .map((fixture) => fixture.seededUser?.handle ?? null)
      .filter((handle): handle is string => Boolean(handle)),
    LOCAL_FIXTURE_DEFAULT_HANDLE
  ];
}

export function listSeededLocalSubjects(): string[] {
  return Object.values(localIdentityFixtures).map((fixture) => fixture.identity.sub);
}

export function makeLocalFixtureId(seed: string): string {
  return stableUuid(`hidden-adventures:${seed}`);
}
