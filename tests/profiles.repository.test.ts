import { beforeEach, describe, expect, it, vi } from "vitest";

const { dbMock } = vi.hoisted(() => ({
  dbMock: {
    query: vi.fn()
  }
}));

vi.mock("../src/db/client.js", () => ({
  db: dbMock
}));

import { getProfileByHandle, listProfileAdventures } from "../src/features/profiles/repository.js";

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
  });

  it("returns an empty list when the profile handle does not resolve", async () => {
    dbMock.query.mockResolvedValueOnce({
      rows: []
    });

    const result = await listProfileAdventures({
      profileHandle: "missing-user",
      viewerHandle: undefined,
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
            summary: "Best at sunset.",
            body: null,
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
      viewerHandle: "asanfil",
      limit: 10,
      offset: 0
    });

    expect(result).toEqual([
      {
        id: "adventure-1",
        title: "Quiet Ridge",
        summary: "Best at sunset.",
        body: null,
        categorySlug: "viewpoints",
        visibility: "public",
        createdAt: "2026-03-01T00:00:00.000Z",
        publishedAt: "2026-03-02T00:00:00.000Z",
        location: {
          latitude: 34.12,
          longitude: -118.45
        },
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
  });
});
