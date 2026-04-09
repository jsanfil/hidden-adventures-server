import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { z } from "zod";

import { canonicalCategorySlugs } from "../adventures/category-taxonomy.js";
import { stableUuid } from "../../scripts/lib/stable-uuid.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../../..");
const fixturesRoot = path.join(repoRoot, "fixtures", "packs");

const TimestampSchema = z.string().datetime({ offset: true });

const PersonaSchema = z.object({
  key: z.string().min(1),
  authMode: z.enum(["cognito", "test_jwt"]),
  username: z.string().min(1),
  email: z.string().email(),
  emailVerified: z.boolean().default(true),
  testJwtSub: z.string().min(1).optional(),
  user:
    z
      .object({
        handle: z.string().min(3).max(64).regex(/^[a-z0-9_]+$/),
        displayName: z.string().min(1),
        bio: z.string().default(""),
        homeCity: z.string().default(""),
        homeRegion: z.string().default(""),
        accountOrigin: z.enum(["legacy_profile_import", "rebuild_signup"]).default("rebuild_signup"),
        createdAt: TimestampSchema,
        updatedAt: TimestampSchema,
        avatarMediaKey: z.string().min(1).optional(),
        coverMediaKey: z.string().min(1).optional()
      })
      .nullable()
});

const MediaAssetSchema = z.object({
  key: z.string().min(1),
  ownerPersonaKey: z.string().min(1),
  storageKey: z.string().min(1),
  kind: z.string().min(1),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema
});

const ConnectionSchema = z.object({
  key: z.string().min(1),
  userKeyA: z.string().min(1),
  userKeyB: z.string().min(1),
  initiatedByPersonaKey: z.string().min(1),
  status: z.enum(["accepted"]),
  requestedAt: TimestampSchema,
  respondedAt: TimestampSchema,
  updatedAt: TimestampSchema
});

const AdventureSchema = z.object({
  key: z.string().min(1),
  authorPersonaKey: z.string().min(1),
  title: z.string().min(1),
  description: z.string().min(1),
  categorySlug: z.enum(canonicalCategorySlugs),
  visibility: z.enum(["public", "connections", "private"]),
  status: z.enum(["published", "draft", "archived", "pending_moderation"]).default("published"),
  longitude: z.number().optional(),
  latitude: z.number().optional(),
  placeLabel: z.string().optional(),
  primaryMediaKey: z.string().optional(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
  publishedAt: TimestampSchema.optional()
});

const FavoriteSchema = z.object({
  personaKey: z.string().min(1),
  adventureKey: z.string().min(1),
  createdAt: TimestampSchema
});

const RatingSchema = z.object({
  personaKey: z.string().min(1),
  adventureKey: z.string().min(1),
  score: z.number().int().min(1).max(5),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema
});

const CommentSchema = z.object({
  key: z.string().min(1),
  adventureKey: z.string().min(1),
  authorPersonaKey: z.string().min(1),
  body: z.string().min(1),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema
});

const FixturePackSchema = z.object({
  version: z.literal(1),
  pack: z.enum(["qa-rich", "test-core"]),
  targetDatabase: z.string().min(1),
  personas: z.array(PersonaSchema).min(1),
  mediaAssets: z.array(MediaAssetSchema),
  connections: z.array(ConnectionSchema),
  adventures: z.array(AdventureSchema),
  favorites: z.array(FavoriteSchema),
  ratings: z.array(RatingSchema),
  comments: z.array(CommentSchema)
});

export type FixturePack = z.infer<typeof FixturePackSchema>;
export type FixturePersona = z.infer<typeof PersonaSchema>;

function fixturePath(pack: string): string {
  return path.join(fixturesRoot, `${pack}.json`);
}

function ensureUnique<T extends { key: string }>(collection: T[], label: string) {
  const seen = new Set<string>();

  for (const item of collection) {
    if (seen.has(item.key)) {
      throw new Error(`Duplicate ${label} key "${item.key}" in fixture pack.`);
    }

    seen.add(item.key);
  }
}

function ensureReference<T extends string>(value: T, set: Set<string>, label: string) {
  if (!set.has(value)) {
    throw new Error(`Fixture pack is missing referenced ${label} "${value}".`);
  }
}

function validateRelationships(pack: FixturePack) {
  ensureUnique(pack.personas, "persona");
  ensureUnique(pack.mediaAssets, "media asset");
  ensureUnique(pack.connections, "connection");
  ensureUnique(pack.adventures, "adventure");
  ensureUnique(pack.comments, "comment");

  const personaKeys = new Set(pack.personas.map((persona) => persona.key));
  const personaUserKeys = new Set(
    pack.personas.filter((persona) => persona.user).map((persona) => persona.key)
  );
  const mediaKeys = new Set(pack.mediaAssets.map((asset) => asset.key));
  const adventureKeys = new Set(pack.adventures.map((adventure) => adventure.key));

  for (const persona of pack.personas) {
    if (persona.authMode === "test_jwt" && !persona.testJwtSub) {
      throw new Error(`Fixture persona "${persona.key}" requires testJwtSub for test_jwt auth.`);
    }

    if (persona.user?.avatarMediaKey) {
      ensureReference(persona.user.avatarMediaKey, mediaKeys, "avatar media");
    }

    if (persona.user?.coverMediaKey) {
      ensureReference(persona.user.coverMediaKey, mediaKeys, "cover media");
    }
  }

  for (const asset of pack.mediaAssets) {
    ensureReference(asset.ownerPersonaKey, personaUserKeys, "media owner persona");
  }

  for (const connection of pack.connections) {
    ensureReference(connection.userKeyA, personaUserKeys, "connection persona");
    ensureReference(connection.userKeyB, personaUserKeys, "connection persona");
    ensureReference(connection.initiatedByPersonaKey, personaUserKeys, "connection initiator");
  }

  for (const adventure of pack.adventures) {
    ensureReference(adventure.authorPersonaKey, personaUserKeys, "adventure author");

    if (adventure.primaryMediaKey) {
      ensureReference(adventure.primaryMediaKey, mediaKeys, "adventure primary media");
    }
  }

  for (const favorite of pack.favorites) {
    ensureReference(favorite.personaKey, personaUserKeys, "favorite persona");
    ensureReference(favorite.adventureKey, adventureKeys, "favorite adventure");
  }

  for (const rating of pack.ratings) {
    ensureReference(rating.personaKey, personaUserKeys, "rating persona");
    ensureReference(rating.adventureKey, adventureKeys, "rating adventure");
  }

  for (const comment of pack.comments) {
    ensureReference(comment.authorPersonaKey, personaUserKeys, "comment author");
    ensureReference(comment.adventureKey, adventureKeys, "comment adventure");
  }
}

export async function loadFixturePack(packName: string): Promise<FixturePack> {
  const raw = await readFile(fixturePath(packName), "utf8");
  const parsed = FixturePackSchema.parse(JSON.parse(raw));
  validateRelationships(parsed);
  return parsed;
}

export function fixtureUserId(pack: FixturePack, personaKey: string): string {
  return stableUuid(`fixture:${pack.pack}:user:${personaKey}`);
}

export function fixtureMediaAssetId(pack: FixturePack, mediaKey: string): string {
  return stableUuid(`fixture:${pack.pack}:media:${mediaKey}`);
}

export function fixtureConnectionId(pack: FixturePack, connectionKey: string): string {
  return stableUuid(`fixture:${pack.pack}:connection:${connectionKey}`);
}

export function fixtureAdventureId(pack: FixturePack, adventureKey: string): string {
  return stableUuid(`fixture:${pack.pack}:adventure:${adventureKey}`);
}

export function fixtureCommentId(pack: FixturePack, commentKey: string): string {
  return stableUuid(`fixture:${pack.pack}:comment:${commentKey}`);
}

export function fixturePackSummary(pack: FixturePack) {
  return {
    personas: pack.personas.length,
    linkedUsers: pack.personas.filter((persona) => persona.user).length,
    adventures: pack.adventures.length,
    mediaAssets: pack.mediaAssets.length,
    connections: pack.connections.length,
    favorites: pack.favorites.length,
    ratings: pack.ratings.length,
    comments: pack.comments.length
  };
}
