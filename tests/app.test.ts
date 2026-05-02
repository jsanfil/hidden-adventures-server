import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  localFixtureContent,
  localIdentityFixtures
} from "../src/features/auth/local-fixtures.js";

const { dbMock } = vi.hoisted(() => ({
  dbMock: {
    query: vi.fn(),
    checkHealth: vi.fn(),
    close: vi.fn(),
    withClient: vi.fn(),
    withTransaction: vi.fn()
  }
}));

const { fetchMediaObjectMock } = vi.hoisted(() => ({
  fetchMediaObjectMock: vi.fn()
}));

vi.mock("../src/db/client.js", () => ({
  db: dbMock
}));

vi.mock("../src/config/env.js", () => ({
  env: {
    PORT: 3000,
    LOG_LEVEL: "info",
    AUTH_MODE: "local_identity",
    SERVER_RUNTIME_MODE: "local_automation_test_core",
    POSTGRES_DB: "hidden_adventures_test",
    AWS_REGION: "us-west-2",
    S3_BUCKET: "fixture-bucket"
  }
}));

vi.mock("../src/features/media/storage.js", () => ({
  fetchMediaObject: fetchMediaObjectMock
}));

import { buildApp } from "../src/app.js";

type QueryRows<T> = { rows: T[] };

function authHeaders(token = localIdentityFixtures.connected_viewer.token) {
  return {
    authorization: `Bearer ${token}`
  };
}

function makeLocalUserRow(overrides: Record<string, unknown> = {}) {
  return {
    id: localIdentityFixtures.connected_viewer.seededUser?.id ?? "viewer-123",
    cognito_subject: localIdentityFixtures.connected_viewer.identity.sub,
    handle: localIdentityFixtures.connected_viewer.seededUser?.handle,
    email: localIdentityFixtures.connected_viewer.seededUser?.email,
    account_origin: "rebuild_signup",
    status: "active",
    created_at: "2026-03-01T00:00:00.000Z",
    updated_at: "2026-03-10T00:00:00.000Z",
    ...overrides
  };
}

function makeAdventureRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "adventure-1",
    title: "Hidden Falls",
    description: "Bring water and wear good shoes.",
    category_slug: "water_spots",
    visibility: "public",
    created_at: "2026-03-01T00:00:00.000Z",
    published_at: "2026-03-02T00:00:00.000Z",
    latitude: 34.12,
    longitude: -118.45,
    author_handle: localFixtureContent.profileHandle,
    author_display_name: "Fixture Author",
    author_home_city: "Los Angeles",
    author_home_region: "CA",
    primary_media_id: "media-1",
    primary_media_storage_key: "adventures/media-1.jpg",
    favorite_count: 8,
    comment_count: 3,
    rating_count: 2,
    average_rating: 4.5,
    viewer_rating: null,
    place_label: "Hidden Falls Trailhead",
    is_favorited: false,
    distance_miles: null,
    updated_at: "2026-03-03T00:00:00.000Z",
    ...overrides
  };
}

function makeProfileRow(overrides: Record<string, unknown> = {}) {
  return {
    user_id: "user-1",
    handle: localFixtureContent.profileHandle,
    display_name: "Fixture Author",
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
    fetchMediaObjectMock.mockReset();

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
    dbMock.query
      .mockResolvedValueOnce({
        rows: [makeLocalUserRow()]
      } as QueryRows<Record<string, unknown>>)
      .mockResolvedValueOnce({
        rows: [makeAdventureRow()]
      } as QueryRows<Record<string, unknown>>);

    const app = await buildApp();

    const response = await app.inject({
      method: "GET",
      url: "/api/feed?limit=1&offset=0",
      headers: authHeaders()
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      items: [
        {
          id: "adventure-1",
          title: "Hidden Falls",
          description: "Bring water and wear good shoes.",
          categorySlug: "water_spots",
          visibility: "public",
          createdAt: "2026-03-01T00:00:00.000Z",
          publishedAt: "2026-03-02T00:00:00.000Z",
          location: {
            latitude: 34.12,
            longitude: -118.45
          },
          placeLabel: "Hidden Falls Trailhead",
          author: {
            handle: localFixtureContent.profileHandle,
            displayName: "Fixture Author",
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
          },
          isFavorited: false
        }
      ],
      paging: {
        limit: 1,
        offset: 0,
        returned: 1
      }
    });
    expect(dbMock.query).toHaveBeenCalledTimes(2);

    await app.close();
  });

  it("returns geo-scoped feed results with scope metadata and distance miles", async () => {
    dbMock.query
      .mockResolvedValueOnce({
        rows: [makeLocalUserRow()]
      } as QueryRows<Record<string, unknown>>)
      .mockResolvedValueOnce({
        rows: [makeAdventureRow({ distance_miles: 7.4, place_label: "Topanga" })]
      } as QueryRows<Record<string, unknown>>);

    const app = await buildApp();

    const response = await app.inject({
      method: "GET",
      url: "/api/feed?limit=1&offset=0&latitude=34.1201&longitude=-118.4512&radiusMiles=25&sort=distance",
      headers: authHeaders()
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      scope: {
        center: {
          latitude: 34.1201,
          longitude: -118.4512
        },
        radiusMiles: 25
      },
      items: [
        {
          id: "adventure-1",
          title: "Hidden Falls",
          description: "Bring water and wear good shoes.",
          categorySlug: "water_spots",
          visibility: "public",
          createdAt: "2026-03-01T00:00:00.000Z",
          publishedAt: "2026-03-02T00:00:00.000Z",
          location: {
            latitude: 34.12,
            longitude: -118.45
          },
          placeLabel: "Topanga",
          author: {
            handle: localFixtureContent.profileHandle,
            displayName: "Fixture Author",
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
          },
          isFavorited: false,
          distanceMiles: 7.4
        }
      ],
      paging: {
        limit: 1,
        offset: 0,
        returned: 1
      }
    });
    expect(dbMock.query).toHaveBeenCalledTimes(2);

    await app.close();
  });

  it("returns discover home modules through the registered app routes", async () => {
    dbMock.query
      .mockResolvedValueOnce({
        rows: [makeLocalUserRow()]
      } as QueryRows<Record<string, unknown>>)
      .mockResolvedValueOnce({
        rows: [
          {
            id: "user-2",
            handle: "mayaexplores",
            display_name: "Maya Reyes",
            home_city: "Portland",
            home_region: "OR",
            avatar_media_id: "avatar-1",
            avatar_storage_key: "profiles/maya.jpg",
            preview_media_id: "media-10",
            preview_media_storage_key: "adventures/maya-preview.jpg",
            public_adventure_count: "62",
            top_category_slugs: ["water_spots", "caves"]
          }
        ]
      } as QueryRows<Record<string, unknown>>)
      .mockResolvedValueOnce({
        rows: [makeAdventureRow({
          id: "discover-adventure-1",
          title: "Eagle Creek Trail to Tunnel Falls",
          author_handle: "mayaexplores",
          author_display_name: "Maya Reyes",
          author_home_city: "Portland",
          author_home_region: "OR",
          favorite_count: 3104,
          comment_count: 118,
          rating_count: 847,
          average_rating: 4.9,
          place_label: "Columbia River Gorge, OR"
        })]
      } as QueryRows<Record<string, unknown>>);

    const app = await buildApp();

    const response = await app.inject({
      method: "GET",
      url: "/api/discover/home",
      headers: authHeaders()
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      modules: [
        {
          id: "explore-adventurers",
          type: "adventurers",
          title: "Explore Adventurers",
          items: [
            {
              id: "user-2",
              handle: "mayaexplores",
              displayName: "Maya Reyes",
              homeCity: "Portland",
              homeRegion: "OR",
              avatar: {
                id: "avatar-1",
                storageKey: "profiles/maya.jpg"
              },
              previewMedia: {
                id: "media-10",
                storageKey: "adventures/maya-preview.jpg"
              },
              publicAdventureCount: 62,
              topCategorySlugs: ["water_spots", "caves"]
            }
          ]
        },
        {
          id: "popular-adventures",
          type: "adventures",
          title: "Popular Adventures",
          items: [
            {
              id: "discover-adventure-1",
              title: "Eagle Creek Trail to Tunnel Falls",
              description: "Bring water and wear good shoes.",
              categorySlug: "water_spots",
              visibility: "public",
              createdAt: "2026-03-01T00:00:00.000Z",
              publishedAt: "2026-03-02T00:00:00.000Z",
              location: {
                latitude: 34.12,
                longitude: -118.45
              },
              placeLabel: "Columbia River Gorge, OR",
              author: {
                handle: "mayaexplores",
                displayName: "Maya Reyes",
                homeCity: "Portland",
                homeRegion: "OR"
              },
              primaryMedia: {
                id: "media-1",
                storageKey: "adventures/media-1.jpg"
              },
              stats: {
                favoriteCount: 3104,
                commentCount: 118,
                ratingCount: 847,
                averageRating: 4.9
              },
              isFavorited: false
            }
          ]
        }
      ]
    });

    await app.close();
  });

  it("returns grouped discover search results through the registered app routes", async () => {
    dbMock.query
      .mockResolvedValueOnce({
        rows: [makeLocalUserRow()]
      } as QueryRows<Record<string, unknown>>)
      .mockResolvedValueOnce({
        rows: [
          {
            id: "user-2",
            handle: "mayaexplores",
            display_name: "Maya Reyes",
            home_city: "Portland",
            home_region: "OR",
            avatar_media_id: null,
            avatar_storage_key: null,
            preview_media_id: null,
            preview_media_storage_key: null,
            public_adventure_count: "62",
            top_category_slugs: ["water_spots", "caves"]
          }
        ]
      } as QueryRows<Record<string, unknown>>)
      .mockResolvedValueOnce({
        rows: [makeAdventureRow({
          id: "discover-adventure-1",
          title: "Eagle Creek Trail to Tunnel Falls",
          author_handle: "mayaexplores",
          author_display_name: "Maya Reyes",
          author_home_city: "Portland",
          author_home_region: "OR",
          place_label: "Columbia River Gorge, OR"
        })]
      } as QueryRows<Record<string, unknown>>);

    const app = await buildApp();

    const response = await app.inject({
      method: "GET",
      url: "/api/discover/search?q=Maya&limit=5&offset=10",
      headers: authHeaders()
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      query: "Maya",
      people: {
        items: [
          {
            id: "user-2",
            handle: "mayaexplores",
            displayName: "Maya Reyes",
            homeCity: "Portland",
            homeRegion: "OR",
            avatar: null,
            previewMedia: null,
            publicAdventureCount: 62,
            topCategorySlugs: ["water_spots", "caves"]
          }
        ],
        paging: {
          limit: 5,
          offset: 10,
          returned: 1
        }
      },
      adventures: {
        items: [
          {
            id: "discover-adventure-1",
            title: "Eagle Creek Trail to Tunnel Falls",
            description: "Bring water and wear good shoes.",
            categorySlug: "water_spots",
            visibility: "public",
            createdAt: "2026-03-01T00:00:00.000Z",
            publishedAt: "2026-03-02T00:00:00.000Z",
            location: {
              latitude: 34.12,
              longitude: -118.45
            },
            placeLabel: "Columbia River Gorge, OR",
            author: {
              handle: "mayaexplores",
              displayName: "Maya Reyes",
              homeCity: "Portland",
              homeRegion: "OR"
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
            },
            isFavorited: false
          }
        ],
        paging: {
          limit: 5,
          offset: 10,
          returned: 1
        }
      }
    });

    await app.close();
  });

  it("defaults geo-scoped feed results to recent ordering when sort is omitted", async () => {
    dbMock.query
      .mockResolvedValueOnce({
        rows: [makeLocalUserRow()]
      } as QueryRows<Record<string, unknown>>)
      .mockResolvedValueOnce({
        rows: [makeAdventureRow({ distance_miles: 7.4 })]
      } as QueryRows<Record<string, unknown>>);

    const app = await buildApp();

    const response = await app.inject({
      method: "GET",
      url: "/api/feed?limit=1&offset=0&latitude=34.1201&longitude=-118.4512&radiusMiles=25",
      headers: authHeaders()
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(
      expect.objectContaining({
        scope: {
          center: {
            latitude: 34.1201,
            longitude: -118.4512
          },
          radiusMiles: 25
        },
        paging: {
          limit: 1,
          offset: 0,
          returned: 1
        }
      })
    );

    await app.close();
  });

  it("requires auth for feed reads", async () => {
    const app = await buildApp();

    const response = await app.inject({
      method: "GET",
      url: "/api/feed?limit=1&offset=0"
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({
      error: "Authentication required."
    });
    expect(dbMock.query).not.toHaveBeenCalled();

    await app.close();
  });

  it("returns 400 when feed query params are invalid", async () => {
    dbMock.query.mockResolvedValueOnce({
      rows: [makeLocalUserRow()]
    } as QueryRows<Record<string, unknown>>);

    const app = await buildApp();

    const response = await app.inject({
      method: "GET",
      url: "/api/feed?limit=0",
      headers: authHeaders()
    });

    expect(response.statusCode).toBe(400);
    expect(dbMock.query).toHaveBeenCalledTimes(1);

    await app.close();
  });

  it("returns 400 when feed geo query params are partial", async () => {
    dbMock.query.mockResolvedValueOnce({
      rows: [makeLocalUserRow()]
    } as QueryRows<Record<string, unknown>>);

    const app = await buildApp();

    const response = await app.inject({
      method: "GET",
      url: "/api/feed?latitude=34.1201",
      headers: authHeaders()
    });

    expect(response.statusCode).toBe(400);
    expect(dbMock.query).toHaveBeenCalledTimes(1);

    await app.close();
  });

  it("returns 400 when feed requests distance sort without geo scope", async () => {
    dbMock.query.mockResolvedValueOnce({
      rows: [makeLocalUserRow()]
    } as QueryRows<Record<string, unknown>>);

    const app = await buildApp();

    const response = await app.inject({
      method: "GET",
      url: "/api/feed?sort=distance",
      headers: authHeaders()
    });

    expect(response.statusCode).toBe(400);
    expect(dbMock.query).toHaveBeenCalledTimes(1);

    await app.close();
  });

  it("returns adventure detail when visible to the caller", async () => {
    dbMock.query
      .mockResolvedValueOnce({
        rows: [makeLocalUserRow()]
      } as QueryRows<Record<string, unknown>>)
      .mockResolvedValueOnce({
        rows: [makeAdventureRow()]
      } as QueryRows<Record<string, unknown>>);

    const app = await buildApp();

    const response = await app.inject({
      method: "GET",
      url: "/api/adventures/3bb3ba5f-06ae-4f5e-a6ce-45cb62cc87ab",
      headers: authHeaders()
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      item: {
        id: "adventure-1",
        title: "Hidden Falls",
        description: "Bring water and wear good shoes.",
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
          handle: localFixtureContent.profileHandle,
          displayName: "Fixture Author",
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
        },
        isFavorited: false,
        viewerRating: null
      }
    });
    await app.close();
  });

  it("returns 404 when the adventure is not visible or missing", async () => {
    dbMock.query
      .mockResolvedValueOnce({
        rows: [makeLocalUserRow()]
      } as QueryRows<Record<string, unknown>>)
      .mockResolvedValueOnce({
        rows: []
      } as QueryRows<Record<string, unknown>>);

    const app = await buildApp();

    const response = await app.inject({
      method: "GET",
      url: "/api/adventures/3bb3ba5f-06ae-4f5e-a6ce-45cb62cc87ab",
      headers: authHeaders()
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({
      error: "Adventure not found."
    });

    await app.close();
  });

  it("returns ordered adventure media for visible detail screens", async () => {
    dbMock.query
      .mockResolvedValueOnce({
        rows: [makeLocalUserRow()]
      } as QueryRows<Record<string, unknown>>)
      .mockResolvedValueOnce({
        rows: [{ id: "adventure-1" }]
      } as QueryRows<Record<string, unknown>>)
      .mockResolvedValueOnce({
        rows: [
          {
            media_id: "media-1",
            sort_order: 0,
            is_primary: true,
            width: 1200,
            height: 900
          }
        ]
      } as QueryRows<Record<string, unknown>>);

    const app = await buildApp();

    const response = await app.inject({
      method: "GET",
      url: "/api/adventures/3bb3ba5f-06ae-4f5e-a6ce-45cb62cc87ab/media",
      headers: authHeaders()
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      items: [
        {
          id: "media-1",
          sortOrder: 0,
          isPrimary: true,
          width: 1200,
          height: 900
        }
      ]
    });

    await app.close();
  });

  it("returns authenticated media bytes for visible feed and detail cards", async () => {
    dbMock.query
      .mockResolvedValueOnce({
        rows: [makeLocalUserRow()]
      } as QueryRows<Record<string, unknown>>)
      .mockResolvedValueOnce({
        rows: [
          {
            media_id: "media-1",
            storage_key: "adventures/media-1.jpg",
            mime_type: "image/jpeg",
            byte_size: 12,
            width: 1200,
            height: 900,
            updated_at: "2026-03-03T00:00:00.000Z"
          }
        ]
      } as QueryRows<Record<string, unknown>>);
    fetchMediaObjectMock.mockResolvedValue({
      body: Buffer.from("hello world!"),
      contentType: "image/jpeg",
      contentLength: 12,
      etag: '"media-1-etag"'
    });

    const app = await buildApp();

    const response = await app.inject({
      method: "GET",
      url: "/api/media/5c6d39fe-86e0-4c90-b143-4f44d8c32197",
      headers: authHeaders()
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("image/jpeg");
    expect(response.headers.etag).toBe('"media-1-etag"');
    expect(response.body).toBe("hello world!");

    await app.close();
  });

  it("returns authenticated media bytes for profile avatars", async () => {
    dbMock.query
      .mockResolvedValueOnce({
        rows: [makeLocalUserRow()]
      } as QueryRows<Record<string, unknown>>)
      .mockResolvedValueOnce({
        rows: [
          {
            media_id: "avatar-1",
            storage_key: "profile-avatars/avatar-1.jpg",
            mime_type: "image/jpeg",
            byte_size: 12,
            width: 512,
            height: 512,
            updated_at: "2026-03-03T00:00:00.000Z"
          }
        ]
      } as QueryRows<Record<string, unknown>>);
    fetchMediaObjectMock.mockResolvedValue({
      body: Buffer.from("avatar-bytes"),
      contentType: "image/jpeg",
      contentLength: 12,
      etag: '"avatar-etag"'
    });

    const app = await buildApp();

    const response = await app.inject({
      method: "GET",
      url: "/api/media/f62dfe1e-4525-5dea-addf-5ad4ccb43108",
      headers: authHeaders()
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("image/jpeg");
    expect(response.headers.etag).toBe('"avatar-etag"');
    expect(response.body).toBe("avatar-bytes");

    await app.close();
  });

  it("returns profile data and visible authored adventures", async () => {
    dbMock.query
      .mockResolvedValueOnce({
        rows: [makeLocalUserRow()]
      } as QueryRows<Record<string, unknown>>)
      .mockResolvedValueOnce({
        rows: [makeProfileRow()]
      } as QueryRows<Record<string, unknown>>)
      .mockResolvedValueOnce({
        rows: [makeProfileRow()]
      } as QueryRows<Record<string, unknown>>)
      .mockResolvedValueOnce({
        rows: [makeAdventureRow()]
      } as QueryRows<Record<string, unknown>>);

    const app = await buildApp();

    const response = await app.inject({
      method: "GET",
      url: `/api/profiles/${localFixtureContent.profileHandle}?limit=1&offset=0`,
      headers: authHeaders()
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      profile: {
        id: "user-1",
        handle: localFixtureContent.profileHandle,
        displayName: "Fixture Author",
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
          description: "Bring water and wear good shoes.",
          categorySlug: "water_spots",
          visibility: "public",
          createdAt: "2026-03-01T00:00:00.000Z",
          publishedAt: "2026-03-02T00:00:00.000Z",
          location: {
            latitude: 34.12,
            longitude: -118.45
          },
          placeLabel: null,
          author: {
            handle: localFixtureContent.profileHandle,
            displayName: "Fixture Author",
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
          },
          isFavorited: false
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

  it("favorites an adventure through the registered app routes", async () => {
    dbMock.query
      .mockResolvedValueOnce({
        rows: [makeLocalUserRow()]
      } as QueryRows<Record<string, unknown>>)
      .mockResolvedValueOnce({
        rows: [makeAdventureRow({ is_favorited: false })]
      } as QueryRows<Record<string, unknown>>)
      .mockResolvedValueOnce({
        rows: []
      } as QueryRows<Record<string, unknown>>)
      .mockResolvedValueOnce({
        rows: [makeAdventureRow({ is_favorited: true })]
      } as QueryRows<Record<string, unknown>>);

    const app = await buildApp();

    const response = await app.inject({
      method: "POST",
      url: "/api/adventures/3bb3ba5f-06ae-4f5e-a6ce-45cb62cc87ab/favorite",
      headers: authHeaders()
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      item: expect.objectContaining({
        id: "adventure-1",
        isFavorited: true
      })
    });

    await app.close();
  });

  it("unfavorites an adventure through the registered app routes", async () => {
    dbMock.query
      .mockResolvedValueOnce({
        rows: [makeLocalUserRow()]
      } as QueryRows<Record<string, unknown>>)
      .mockResolvedValueOnce({
        rows: [makeAdventureRow({ is_favorited: true })]
      } as QueryRows<Record<string, unknown>>)
      .mockResolvedValueOnce({
        rows: []
      } as QueryRows<Record<string, unknown>>)
      .mockResolvedValueOnce({
        rows: [makeAdventureRow({ is_favorited: false })]
      } as QueryRows<Record<string, unknown>>);

    const app = await buildApp();

    const response = await app.inject({
      method: "DELETE",
      url: "/api/adventures/3bb3ba5f-06ae-4f5e-a6ce-45cb62cc87ab/favorite",
      headers: authHeaders()
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      item: expect.objectContaining({
        id: "adventure-1",
        isFavorited: false
      })
    });

    await app.close();
  });

  it("upserts a rating through the registered app routes", async () => {
    dbMock.query
      .mockResolvedValueOnce({
        rows: [makeLocalUserRow()]
      } as QueryRows<Record<string, unknown>>)
      .mockResolvedValueOnce({
        rows: [makeAdventureRow({ viewer_rating: null, rating_count: 2, average_rating: 4.5 })]
      } as QueryRows<Record<string, unknown>>)
      .mockResolvedValueOnce({
        rows: []
      } as QueryRows<Record<string, unknown>>)
      .mockResolvedValueOnce({
        rows: []
      } as QueryRows<Record<string, unknown>>)
      .mockResolvedValueOnce({
        rows: [makeAdventureRow({ viewer_rating: 4, rating_count: 3, average_rating: 4.33 })]
      } as QueryRows<Record<string, unknown>>);

    const app = await buildApp();

    const response = await app.inject({
      method: "POST",
      url: "/api/adventures/3bb3ba5f-06ae-4f5e-a6ce-45cb62cc87ab/rating",
      headers: authHeaders(),
      payload: {
        score: 4
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      item: expect.objectContaining({
        id: "adventure-1",
        viewerRating: 4
      })
    });

    await app.close();
  });

  it("deletes a rating through the registered app routes", async () => {
    dbMock.query
      .mockResolvedValueOnce({
        rows: [makeLocalUserRow()]
      } as QueryRows<Record<string, unknown>>)
      .mockResolvedValueOnce({
        rows: [makeAdventureRow({ viewer_rating: 4, rating_count: 3, average_rating: 4.33 })]
      } as QueryRows<Record<string, unknown>>)
      .mockResolvedValueOnce({
        rows: []
      } as QueryRows<Record<string, unknown>>)
      .mockResolvedValueOnce({
        rows: []
      } as QueryRows<Record<string, unknown>>)
      .mockResolvedValueOnce({
        rows: [makeAdventureRow({ viewer_rating: null, rating_count: 2, average_rating: 4.5 })]
      } as QueryRows<Record<string, unknown>>);

    const app = await buildApp();

    const response = await app.inject({
      method: "DELETE",
      url: "/api/adventures/3bb3ba5f-06ae-4f5e-a6ce-45cb62cc87ab/rating",
      headers: authHeaders()
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      item: expect.objectContaining({
        id: "adventure-1",
        viewerRating: null
      })
    });

    await app.close();
  });

  it("returns the authenticated viewer favorites collection", async () => {
    dbMock.query
      .mockResolvedValueOnce({
        rows: [makeLocalUserRow()]
      } as QueryRows<Record<string, unknown>>)
      .mockResolvedValueOnce({
        rows: [makeProfileRow({
          handle: localIdentityFixtures.connected_viewer.seededUser?.handle,
          display_name: "Viewer"
        })]
      } as QueryRows<Record<string, unknown>>)
      .mockResolvedValueOnce({
        rows: [makeAdventureRow({ is_favorited: true, place_label: "Malibu" })]
      } as QueryRows<Record<string, unknown>>);

    const app = await buildApp();

    const response = await app.inject({
      method: "GET",
      url: `/api/profiles/${localIdentityFixtures.connected_viewer.seededUser?.handle}/favorites?limit=1&offset=0`,
      headers: authHeaders()
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      items: [
        expect.objectContaining({
          id: "adventure-1",
          placeLabel: "Malibu",
          isFavorited: true
        })
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
    dbMock.query
      .mockResolvedValueOnce({
        rows: [makeLocalUserRow()]
      } as QueryRows<Record<string, unknown>>)
      .mockResolvedValueOnce({
        rows: []
      } as QueryRows<Record<string, unknown>>);

    const app = await buildApp();

    const response = await app.inject({
      method: "GET",
      url: "/api/profiles/missing-user",
      headers: authHeaders()
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({
      error: "Profile not found."
    });

    await app.close();
  });
});
