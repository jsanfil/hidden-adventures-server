import { beforeEach, describe, expect, it, vi } from "vitest";

const { dbMock } = vi.hoisted(() => ({
  dbMock: {
    query: vi.fn()
  }
}));

vi.mock("../src/db/client.js", () => ({
  db: dbMock
}));

import {
  getProfileByHandle,
  getProfileByUserId,
  listProfileAdventures,
  updateMyProfile
} from "../src/features/profiles/repository.js";

describe("profiles repository", () => {
  beforeEach(() => {
    dbMock.query.mockReset();
  });

  it("maps a profile without exposing any extra fields", async () => {
    dbMock.query.mockResolvedValue({
      rows: [
        {
          user_id: "user-1",
          handle: "jacksanfil",
          display_name: "Jack",
          bio: "Explorer",
          home_city: "Los Angeles",
          home_region: "CA",
          avatar_media_id: null,
          avatar_storage_key: null,
          cover_media_id: "cover-1",
          cover_storage_key: "profiles/cover-1.jpg",
          created_at: "2026-01-01T00:00:00.000Z",
          updated_at: "2026-03-01T00:00:00.000Z"
        }
      ]
    });

    const result = await getProfileByHandle("jacksanfil");

    expect(result).toEqual({
      id: "user-1",
      handle: "jacksanfil",
      displayName: "Jack",
      bio: "Explorer",
      homeCity: "Los Angeles",
      homeRegion: "CA",
      avatar: null,
      cover: {
        id: "cover-1",
        storageKey: "profiles/cover-1.jpg"
      },
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-03-01T00:00:00.000Z"
    });
    expect(dbMock.query).toHaveBeenCalledWith(expect.stringContaining("where users.handle = $1"), [
      "jacksanfil"
    ]);
  });

  it("resolves a profile by authenticated user id", async () => {
    dbMock.query.mockResolvedValue({
      rows: [
        {
          user_id: "user-1",
          handle: "viewer",
          display_name: "Viewer",
          bio: "Explorer",
          home_city: "Portland",
          home_region: "OR",
          avatar_media_id: null,
          avatar_storage_key: null,
          cover_media_id: null,
          cover_storage_key: null,
          created_at: "2026-01-01T00:00:00.000Z",
          updated_at: "2026-03-01T00:00:00.000Z"
        }
      ]
    });

    const result = await getProfileByUserId("user-1");

    expect(result).toEqual({
      id: "user-1",
      handle: "viewer",
      displayName: "Viewer",
      bio: "Explorer",
      homeCity: "Portland",
      homeRegion: "OR",
      avatar: null,
      cover: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-03-01T00:00:00.000Z"
    });
    expect(dbMock.query).toHaveBeenCalledWith(expect.stringContaining("where users.id = $1::uuid"), [
      "user-1"
    ]);
  });

  it("normalizes blanks to null and returns the saved profile when updating my profile", async () => {
    dbMock.query.mockResolvedValue({
      rows: [
        {
          user_id: "user-1",
          handle: "viewer",
          display_name: "Viewer",
          bio: null,
          home_city: "Seattle",
          home_region: null,
          avatar_media_id: null,
          avatar_storage_key: null,
          cover_media_id: null,
          cover_storage_key: null,
          created_at: "2026-01-01T00:00:00.000Z",
          updated_at: "2026-03-02T00:00:00.000Z"
        }
      ]
    });

    const result = await updateMyProfile("user-1", {
      displayName: " Viewer ",
      bio: "   ",
      homeCity: " Seattle ",
      homeRegion: ""
    });

    expect(result).toEqual({
      id: "user-1",
      handle: "viewer",
      displayName: "Viewer",
      bio: null,
      homeCity: "Seattle",
      homeRegion: null,
      avatar: null,
      cover: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-03-02T00:00:00.000Z"
    });
    expect(dbMock.query).toHaveBeenCalledWith(expect.stringContaining("insert into public.profiles"), [
      "user-1",
      "Viewer",
      null,
      "Seattle",
      null
    ]);
  });

  it("returns an empty list when the profile handle does not resolve", async () => {
    dbMock.query.mockResolvedValueOnce({
      rows: []
    });

    const result = await listProfileAdventures({
      profileHandle: "missing-user",
      viewerId: undefined,
      limit: 20,
      offset: 0
    });

    expect(result).toEqual([]);
    expect(dbMock.query).toHaveBeenCalledTimes(1);
  });

  it("maps authored adventures using the resolved profile as author data", async () => {
    dbMock.query
      .mockResolvedValueOnce({
        rows: [
          {
            user_id: "user-1",
            handle: "jacksanfil",
            display_name: "Jack",
            bio: "Explorer",
            home_city: "Los Angeles",
            home_region: "CA",
            avatar_media_id: null,
            avatar_storage_key: null,
            cover_media_id: null,
            cover_storage_key: null,
            created_at: "2026-01-01T00:00:00.000Z",
            updated_at: "2026-03-01T00:00:00.000Z"
          }
        ]
      })
      .mockResolvedValueOnce({
        rows: [
          {
            id: "adventure-1",
            title: "Quiet Ridge",
            description: "Best at sunset.",
            category_slug: "viewpoints",
            visibility: "public",
            created_at: "2026-03-01T00:00:00.000Z",
            published_at: "2026-03-02T00:00:00.000Z",
            latitude: 34.12,
            longitude: -118.45,
            primary_media_id: null,
            primary_media_storage_key: null,
            favorite_count: 1,
            comment_count: 2,
            rating_count: 3,
            average_rating: 4.67
          }
        ]
      });

    const result = await listProfileAdventures({
      profileHandle: "jacksanfil",
      viewerId: "viewer-1",
      limit: 10,
      offset: 0
    });

    expect(result).toEqual([
      {
        id: "adventure-1",
        title: "Quiet Ridge",
        description: "Best at sunset.",
        categorySlug: "viewpoints",
        visibility: "public",
        createdAt: "2026-03-01T00:00:00.000Z",
        publishedAt: "2026-03-02T00:00:00.000Z",
        location: {
          latitude: 34.12,
          longitude: -118.45
        },
        placeLabel: null,
        author: {
          handle: "jacksanfil",
          displayName: "Jack",
          homeCity: "Los Angeles",
          homeRegion: "CA"
        },
        primaryMedia: null,
        stats: {
          favoriteCount: 1,
          commentCount: 2,
          ratingCount: 3,
          averageRating: 4.67
        }
      }
    ]);
    expect(dbMock.query).toHaveBeenNthCalledWith(2, expect.stringContaining("select $1::uuid as id"), [
      "viewer-1",
      "jacksanfil",
      10,
      0
    ]);
  });
});
