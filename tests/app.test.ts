import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { dbMock } = vi.hoisted(() => ({
  dbMock: {
    query: vi.fn(),
    checkHealth: vi.fn(),
    close: vi.fn(),
    withClient: vi.fn(),
    withTransaction: vi.fn()
  }
}));

vi.mock("../src/db/client.js", () => ({
  db: dbMock
}));

import { buildApp } from "../src/app.js";

type QueryRows<T> = { rows: T[] };

function makeAdventureRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "adventure-1",
    title: "Hidden Falls",
    summary: "A short trail to a quiet waterfall.",
    body: "Bring water and wear good shoes.",
    category_slug: "water_spots",
    visibility: "public",
    created_at: "2026-03-01T00:00:00.000Z",
    published_at: "2026-03-02T00:00:00.000Z",
    latitude: 34.12,
    longitude: -118.45,
    author_handle: "jacksanfil",
    author_display_name: "Jack",
    author_home_city: "Los Angeles",
    author_home_region: "CA",
    primary_media_id: "media-1",
    primary_media_storage_key: "adventures/media-1.jpg",
    favorite_count: 8,
    comment_count: 3,
    rating_count: 2,
    average_rating: 4.5,
    place_label: "Hidden Falls Trailhead",
    updated_at: "2026-03-03T00:00:00.000Z",
    ...overrides
  };
}

function makeProfileRow(overrides: Record<string, unknown> = {}) {
  return {
    user_id: "user-1",
    handle: "jacksanfil",
    display_name: "Jack",
    bio: "Collector of hidden spots.",
    home_city: "Los Angeles",
    home_region: "CA",
    avatar_media_id: "avatar-1",
    avatar_storage_key: "profiles/avatar-1.jpg",
    cover_media_id: "cover-1",
    cover_storage_key: "profiles/cover-1.jpg",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-03-01T00:00:00.000Z",
    ...overrides
  };
}

describe("buildApp", () => {
  beforeEach(() => {
    dbMock.query.mockReset();
    dbMock.checkHealth.mockReset();
    dbMock.close.mockReset();
    dbMock.withTransaction.mockReset();

    dbMock.withTransaction.mockImplementation(async (callback) => callback({ query: dbMock.query }));
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns ready status at the root endpoint", async () => {
    const app = await buildApp();

    const response = await app.inject({
      method: "GET",
      url: "/"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      service: "hidden-adventures-server",
      status: "ready"
    });

    await app.close();
  });

  it("returns health check details when the database is healthy", async () => {
    dbMock.checkHealth.mockResolvedValue({
      latencyMs: 12.34
    });

    const app = await buildApp();

    const response = await app.inject({
      method: "GET",
      url: "/api/health"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      ok: true,
      service: "hidden-adventures-server",
      checks: {
        database: {
          ok: true,
          latencyMs: 12.34
        }
      }
    });

    await app.close();
  });

  it("returns 503 when the database health check fails", async () => {
    dbMock.checkHealth.mockRejectedValue(new Error("db down"));

    const app = await buildApp();

    const response = await app.inject({
      method: "GET",
      url: "/api/health"
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({
      ok: false,
      service: "hidden-adventures-server",
      checks: {
        database: {
          ok: false
        }
      }
    });

    await app.close();
  });

  it("returns the feed with paging metadata", async () => {
    dbMock.query.mockResolvedValue({
      rows: [makeAdventureRow()]
    } as QueryRows<Record<string, unknown>>);

    const app = await buildApp();

    const response = await app.inject({
      method: "GET",
      url: "/api/feed?limit=1&offset=0"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      items: [
        {
          id: "adventure-1",
          title: "Hidden Falls",
          summary: "A short trail to a quiet waterfall.",
          body: "Bring water and wear good shoes.",
          categorySlug: "water_spots",
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
          primaryMedia: {
            id: "media-1",
            storageKey: "adventures/media-1.jpg"
          },
          stats: {
            favoriteCount: 8,
            commentCount: 3,
            ratingCount: 2,
            averageRating: 4.5
          }
        }
      ],
      paging: {
        limit: 1,
        offset: 0,
        returned: 1
      }
    });
    expect(dbMock.query).toHaveBeenCalledTimes(1);

    await app.close();
  });

  it("returns 400 when feed query params are invalid", async () => {
    const app = await buildApp();

    const response = await app.inject({
      method: "GET",
      url: "/api/feed?limit=0"
    });

    expect(response.statusCode).toBe(400);
    expect(dbMock.query).not.toHaveBeenCalled();

    await app.close();
  });

  it("returns adventure detail when visible to the caller", async () => {
    dbMock.query.mockResolvedValue({
      rows: [makeAdventureRow()]
    } as QueryRows<Record<string, unknown>>);

    const app = await buildApp();

    const response = await app.inject({
      method: "GET",
      url: "/api/adventures/3bb3ba5f-06ae-4f5e-a6ce-45cb62cc87ab"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      item: {
        id: "adventure-1",
        title: "Hidden Falls",
        summary: "A short trail to a quiet waterfall.",
        body: "Bring water and wear good shoes.",
        categorySlug: "water_spots",
        visibility: "public",
        createdAt: "2026-03-01T00:00:00.000Z",
        publishedAt: "2026-03-02T00:00:00.000Z",
        updatedAt: "2026-03-03T00:00:00.000Z",
        placeLabel: "Hidden Falls Trailhead",
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
        primaryMedia: {
          id: "media-1",
          storageKey: "adventures/media-1.jpg"
        },
        stats: {
          favoriteCount: 8,
          commentCount: 3,
          ratingCount: 2,
          averageRating: 4.5
        }
      }
    });
    await app.close();
  });

  it("returns 404 when the adventure is not visible or missing", async () => {
    dbMock.query.mockResolvedValue({
      rows: []
    } as QueryRows<Record<string, unknown>>);

    const app = await buildApp();

    const response = await app.inject({
      method: "GET",
      url: "/api/adventures/3bb3ba5f-06ae-4f5e-a6ce-45cb62cc87ab"
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({
      error: "Adventure not found."
    });

    await app.close();
  });

  it("returns profile data and visible authored adventures", async () => {
    dbMock.query
      .mockResolvedValueOnce({
        rows: [makeProfileRow()]
      } as QueryRows<Record<string, unknown>>)
      .mockResolvedValueOnce({
        rows: [makeProfileRow()]
      } as QueryRows<Record<string, unknown>>)
      .mockResolvedValueOnce({
        rows: [makeAdventureRow({ author_handle: undefined, author_display_name: undefined })]
      } as QueryRows<Record<string, unknown>>);

    const app = await buildApp();

    const response = await app.inject({
      method: "GET",
      url: "/api/profiles/jacksanfil?limit=1&offset=0"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      profile: {
        id: "user-1",
        handle: "jacksanfil",
        displayName: "Jack",
        bio: "Collector of hidden spots.",
        homeCity: "Los Angeles",
        homeRegion: "CA",
        avatar: {
          id: "avatar-1",
          storageKey: "profiles/avatar-1.jpg"
        },
        cover: {
          id: "cover-1",
          storageKey: "profiles/cover-1.jpg"
        },
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-03-01T00:00:00.000Z"
      },
      adventures: [
        {
          id: "adventure-1",
          title: "Hidden Falls",
          summary: "A short trail to a quiet waterfall.",
          body: "Bring water and wear good shoes.",
          categorySlug: "water_spots",
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
          primaryMedia: {
            id: "media-1",
            storageKey: "adventures/media-1.jpg"
          },
          stats: {
            favoriteCount: 8,
            commentCount: 3,
            ratingCount: 2,
            averageRating: 4.5
          }
        }
      ],
      paging: {
        limit: 1,
        offset: 0,
        returned: 1
      }
    });
    await app.close();
  });

  it("returns 404 when the profile does not exist", async () => {
    dbMock.query.mockResolvedValueOnce({
      rows: []
    } as QueryRows<Record<string, unknown>>);

    const app = await buildApp();

    const response = await app.inject({
      method: "GET",
      url: "/api/profiles/missing-user"
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({
      error: "Profile not found."
    });

    await app.close();
  });
});
