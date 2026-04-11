import Fastify from "fastify";
import { ZodError } from "zod";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { localIdentityFixtures } from "../src/features/auth/local-fixtures.js";

const {
  dbMock,
  checkMediaObjectExistsMock,
  fetchMediaObjectMock,
  createAdventureMock,
  getAdventureByIdMock,
  getMediaDeliveryTargetMock,
  listAdventureMediaMock,
  listFeedMock
} = vi.hoisted(() => ({
  dbMock: {
    withTransaction: vi.fn()
  },
  checkMediaObjectExistsMock: vi.fn(),
  fetchMediaObjectMock: vi.fn(),
  createAdventureMock: vi.fn(),
  getAdventureByIdMock: vi.fn(),
  getMediaDeliveryTargetMock: vi.fn(),
  listAdventureMediaMock: vi.fn(),
  listFeedMock: vi.fn()
}));

vi.mock("../src/db/client.js", () => ({
  db: dbMock
}));

const { listOwnedMediaAssetsForAdventureCreateMock } = vi.hoisted(() => ({
  listOwnedMediaAssetsForAdventureCreateMock: vi.fn()
}));

vi.mock("../src/features/adventures/repository.js", () => ({
  createAdventure: createAdventureMock,
  getAdventureById: getAdventureByIdMock,
  getMediaDeliveryTarget: getMediaDeliveryTargetMock,
  listAdventureMedia: listAdventureMediaMock,
  listFeed: listFeedMock
}));

vi.mock("../src/features/media/repository.js", () => ({
  listOwnedMediaAssetsForAdventureCreate: listOwnedMediaAssetsForAdventureCreateMock
}));

vi.mock("../src/features/media/storage.js", () => ({
  checkMediaObjectExists: checkMediaObjectExistsMock,
  fetchMediaObject: fetchMediaObjectMock
}));

vi.mock("../src/config/env.js", () => ({
  env: {
    AWS_REGION: "us-west-2",
    S3_BUCKET: "fixture-bucket"
  }
}));

import { adventureRoutes } from "../src/features/adventures/routes.js";

async function buildAdventureRouteApp(viewerId?: string) {
  const app = Fastify();
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError) {
      return reply.code(400).send({
        error: "Invalid request."
      });
    }

    throw error;
  });
  app.decorateRequest("authContext", null);
  app.addHook("onRequest", async (request) => {
    (request as typeof request & { authContext: unknown }).authContext = viewerId
      ? {
          identity: localIdentityFixtures.connected_viewer.identity,
          viewer: {
            id: viewerId
          }
        }
      : null;
  });

  await app.register(adventureRoutes, { prefix: "/api" });
  return app;
}

describe("adventure routes", () => {
  beforeEach(() => {
    dbMock.withTransaction.mockReset();
    dbMock.withTransaction.mockImplementation(async (callback: (client: { query: typeof vi.fn }) => unknown) =>
      callback({ query: vi.fn() })
    );
    listFeedMock.mockReset();
    createAdventureMock.mockReset();
    getAdventureByIdMock.mockReset();
    listAdventureMediaMock.mockReset();
    getMediaDeliveryTargetMock.mockReset();
    listOwnedMediaAssetsForAdventureCreateMock.mockReset();
    checkMediaObjectExistsMock.mockReset();
    fetchMediaObjectMock.mockReset();
  });

  it("requires auth for feed reads", async () => {
    const app = await buildAdventureRouteApp();

    const response = await app.inject({
      method: "GET",
      url: "/api/feed?limit=1&offset=0"
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({
      error: "Authentication required."
    });
    expect(listFeedMock).not.toHaveBeenCalled();

    await app.close();
  });

  it("passes authContext.viewer.id into feed reads", async () => {
    listFeedMock.mockResolvedValue({
      items: [
        {
          id: "adventure-1",
          title: "Hidden Falls",
          description: "Bring water and wear good shoes.",
          categorySlug: "water_spots",
          visibility: "public",
          createdAt: "2026-03-01T00:00:00.000Z",
          publishedAt: "2026-03-02T00:00:00.000Z",
          location: null,
          placeLabel: "Hidden Falls Trailhead",
          author: {
            handle: "jacksanfil",
            displayName: "Jack",
            homeCity: "Los Angeles",
            homeRegion: "CA"
          },
          primaryMedia: null,
          stats: {
            favoriteCount: 0,
            commentCount: 0,
            ratingCount: 0,
            averageRating: 0
          }
        }
      ]
    });

    const app = await buildAdventureRouteApp(localIdentityFixtures.connected_viewer.seededUser?.id);

    const response = await app.inject({
      method: "GET",
      url: "/api/feed?limit=1&offset=0"
    });

    expect(response.statusCode).toBe(200);
    expect(listFeedMock).toHaveBeenCalledWith({
      viewerId: localIdentityFixtures.connected_viewer.seededUser?.id,
      limit: 1,
      offset: 0,
      latitude: undefined,
      longitude: undefined,
      radiusMiles: undefined,
      sort: undefined
    });
    expect(response.json()).toEqual({
      items: [
        expect.objectContaining({
          id: "adventure-1",
          author: expect.objectContaining({
            handle: "jacksanfil"
          })
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

  it("returns geo-scoped feed metadata and forwards geo params", async () => {
    listFeedMock.mockResolvedValue({
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
            handle: "jacksanfil",
            displayName: "Jack",
            homeCity: "Los Angeles",
            homeRegion: "CA"
          },
          primaryMedia: null,
          stats: {
            favoriteCount: 0,
            commentCount: 0,
            ratingCount: 0,
            averageRating: 0
          },
          distanceMiles: 7.4
        }
      ]
    });

    const app = await buildAdventureRouteApp(localIdentityFixtures.connected_viewer.seededUser?.id);

    const response = await app.inject({
      method: "GET",
      url: "/api/feed?limit=1&offset=0&latitude=34.1201&longitude=-118.4512&radiusMiles=25&sort=distance"
    });

    expect(response.statusCode).toBe(200);
    expect(listFeedMock).toHaveBeenCalledWith({
      viewerId: localIdentityFixtures.connected_viewer.seededUser?.id,
      limit: 1,
      offset: 0,
      latitude: 34.1201,
      longitude: -118.4512,
      radiusMiles: 25,
      sort: "distance"
    });
    expect(response.json()).toEqual({
      scope: {
        center: {
          latitude: 34.1201,
          longitude: -118.4512
        },
        radiusMiles: 25
      },
      items: [
        expect.objectContaining({
          id: "adventure-1",
          distanceMiles: 7.4
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

  it("defaults geo-scoped feed reads to recent sorting when sort is omitted", async () => {
    listFeedMock.mockResolvedValue({
      scope: {
        center: {
          latitude: 34.1201,
          longitude: -118.4512
        },
        radiusMiles: 25
      },
      items: []
    });

    const app = await buildAdventureRouteApp(localIdentityFixtures.connected_viewer.seededUser?.id);

    const response = await app.inject({
      method: "GET",
      url: "/api/feed?limit=1&offset=0&latitude=34.1201&longitude=-118.4512&radiusMiles=25"
    });

    expect(response.statusCode).toBe(200);
    expect(listFeedMock).toHaveBeenCalledWith({
      viewerId: localIdentityFixtures.connected_viewer.seededUser?.id,
      limit: 1,
      offset: 0,
      latitude: 34.1201,
      longitude: -118.4512,
      radiusMiles: 25,
      sort: undefined
    });

    await app.close();
  });

  it("passes authContext.viewer.id into detail reads", async () => {
    getAdventureByIdMock.mockResolvedValue({
      id: "adventure-1",
      title: "Hidden Falls",
      description: "Bring water and wear good shoes.",
      categorySlug: "water_spots",
      visibility: "public",
      createdAt: "2026-03-01T00:00:00.000Z",
      publishedAt: "2026-03-02T00:00:00.000Z",
      updatedAt: "2026-03-03T00:00:00.000Z",
      placeLabel: "Hidden Falls Trailhead",
      location: null,
      author: {
        handle: "jacksanfil",
        displayName: "Jack",
        homeCity: "Los Angeles",
        homeRegion: "CA"
      },
      primaryMedia: null,
      stats: {
        favoriteCount: 0,
        commentCount: 0,
        ratingCount: 0,
        averageRating: 0
      }
    });

    const app = await buildAdventureRouteApp(localIdentityFixtures.connected_viewer.seededUser?.id);

    const response = await app.inject({
      method: "GET",
      url: "/api/adventures/3bb3ba5f-06ae-4f5e-a6ce-45cb62cc87ab"
    });

    expect(response.statusCode).toBe(200);
    expect(getAdventureByIdMock).toHaveBeenCalledWith({
      adventureId: "3bb3ba5f-06ae-4f5e-a6ce-45cb62cc87ab",
      viewerId: localIdentityFixtures.connected_viewer.seededUser?.id
    });

    await app.close();
  });

  it("requires auth for detail reads", async () => {
    const app = await buildAdventureRouteApp();

    const response = await app.inject({
      method: "GET",
      url: "/api/adventures/3bb3ba5f-06ae-4f5e-a6ce-45cb62cc87ab"
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({
      error: "Authentication required."
    });
    expect(getAdventureByIdMock).not.toHaveBeenCalled();

    await app.close();
  });

  it("rejects handle-based viewer query params", async () => {
    const app = await buildAdventureRouteApp(localIdentityFixtures.connected_viewer.seededUser?.id);

    const [feedResponse, detailResponse] = await Promise.all([
      app.inject({
        method: "GET",
        url: "/api/feed?viewerHandle=asanfil"
      }),
      app.inject({
        method: "GET",
        url: "/api/adventures/3bb3ba5f-06ae-4f5e-a6ce-45cb62cc87ab?viewerHandle=asanfil"
      })
    ]);

    expect(feedResponse.statusCode).toBe(400);
    expect(detailResponse.statusCode).toBe(400);
    expect(listFeedMock).not.toHaveBeenCalled();
    expect(getAdventureByIdMock).not.toHaveBeenCalled();

    await app.close();
  });

  it("rejects partial geo feed queries", async () => {
    const app = await buildAdventureRouteApp(localIdentityFixtures.connected_viewer.seededUser?.id);

    const response = await app.inject({
      method: "GET",
      url: "/api/feed?latitude=34.1201"
    });

    expect(response.statusCode).toBe(400);
    expect(listFeedMock).not.toHaveBeenCalled();

    await app.close();
  });

  it("rejects distance sort without geo scope", async () => {
    const app = await buildAdventureRouteApp(localIdentityFixtures.connected_viewer.seededUser?.id);

    const response = await app.inject({
      method: "GET",
      url: "/api/feed?sort=distance"
    });

    expect(response.statusCode).toBe(400);
    expect(listFeedMock).not.toHaveBeenCalled();

    await app.close();
  });

  it("returns ordered media items for visible adventures", async () => {
    listAdventureMediaMock.mockResolvedValue([
      {
        id: "media-1",
        sortOrder: 0,
        isPrimary: true,
        width: 1200,
        height: 900
      }
    ]);

    const app = await buildAdventureRouteApp(localIdentityFixtures.connected_viewer.seededUser?.id);

    const response = await app.inject({
      method: "GET",
      url: "/api/adventures/3bb3ba5f-06ae-4f5e-a6ce-45cb62cc87ab/media"
    });

    expect(response.statusCode).toBe(200);
    expect(listAdventureMediaMock).toHaveBeenCalledWith({
      adventureId: "3bb3ba5f-06ae-4f5e-a6ce-45cb62cc87ab",
      viewerId: localIdentityFixtures.connected_viewer.seededUser?.id
    });
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

  it("streams media bytes for visible media ids", async () => {
    getMediaDeliveryTargetMock.mockResolvedValue({
      id: "media-1",
      storageKey: "fixtures/test-core/adventures/fixture-falls.jpg",
      mimeType: "image/jpeg",
      byteSize: 12,
      width: 1200,
      height: 900,
      updatedAt: "2026-03-03T00:00:00.000Z"
    });
    fetchMediaObjectMock.mockResolvedValue({
      body: Buffer.from("hello world!"),
      contentType: "image/jpeg",
      contentLength: 12,
      etag: '"media-1-etag"'
    });

    const app = await buildAdventureRouteApp(localIdentityFixtures.connected_viewer.seededUser?.id);

    const response = await app.inject({
      method: "GET",
      url: "/api/media/3bb3ba5f-06ae-4f5e-a6ce-45cb62cc87ab"
    });

    expect(response.statusCode).toBe(200);
    expect(getMediaDeliveryTargetMock).toHaveBeenCalledWith({
      mediaId: "3bb3ba5f-06ae-4f5e-a6ce-45cb62cc87ab",
      viewerId: localIdentityFixtures.connected_viewer.seededUser?.id
    });
    expect(fetchMediaObjectMock).toHaveBeenCalledWith({
      bucket: "fixture-bucket",
      key: "fixtures/test-core/adventures/fixture-falls.jpg",
      region: "us-west-2"
    });
    expect(response.headers["content-type"]).toContain("image/jpeg");
    expect(response.headers.etag).toBe('"media-1-etag"');
    expect(response.body).toBe("hello world!");

    await app.close();
  });

  it("creates an adventure from uploaded media", async () => {
    listOwnedMediaAssetsForAdventureCreateMock.mockResolvedValue([
      {
        id: "3bb3ba5f-06ae-4f5e-a6ce-45cb62cc87ab",
        storageKey: "adventures/fixture_author_media-1.jpg",
        mimeType: "image/jpeg",
        byteSize: 123,
        width: 1200,
        height: 900,
        alreadyAttached: false
      }
    ]);
    checkMediaObjectExistsMock.mockResolvedValue(true);
    createAdventureMock.mockResolvedValue({
      id: "adventure-1",
      status: "pending_moderation"
    });

    const app = await buildAdventureRouteApp(localIdentityFixtures.connected_viewer.seededUser?.id);

    const response = await app.inject({
      method: "POST",
      url: "/api/adventures",
      payload: {
        title: "Hidden Falls",
        description: "Bring water and wear good shoes.",
        categorySlug: "water_spots",
        visibility: "public",
        location: {
          latitude: 34.12,
          longitude: -118.45
        },
        placeLabel: "Hidden Falls Trailhead",
        media: [
          {
            mediaId: "3bb3ba5f-06ae-4f5e-a6ce-45cb62cc87ab",
            sortOrder: 0,
            isPrimary: true
          }
        ]
      }
    });

    expect(response.statusCode).toBe(201);
    expect(listOwnedMediaAssetsForAdventureCreateMock).toHaveBeenCalledWith({
      ownerUserId: localIdentityFixtures.connected_viewer.seededUser?.id,
      mediaIds: ["3bb3ba5f-06ae-4f5e-a6ce-45cb62cc87ab"]
    });
    expect(createAdventureMock).toHaveBeenCalledWith(
      expect.objectContaining({
        authorUserId: localIdentityFixtures.connected_viewer.seededUser?.id,
        status: "pending_moderation"
      }),
      expect.anything()
    );
    expect(response.json()).toEqual({
      item: {
        id: "adventure-1",
        status: "pending_moderation"
      }
    });

    await app.close();
  });

  it("rejects missing uploaded media before creation", async () => {
    listOwnedMediaAssetsForAdventureCreateMock.mockResolvedValue([
      {
        id: "3bb3ba5f-06ae-4f5e-a6ce-45cb62cc87ab",
        storageKey: "adventures/fixture_author_media-1.jpg",
        mimeType: "image/jpeg",
        byteSize: 123,
        width: 1200,
        height: 900,
        alreadyAttached: false
      }
    ]);
    checkMediaObjectExistsMock.mockResolvedValue(false);

    const app = await buildAdventureRouteApp(localIdentityFixtures.connected_viewer.seededUser?.id);

    const response = await app.inject({
      method: "POST",
      url: "/api/adventures",
      payload: {
        title: "Hidden Falls",
        visibility: "public",
        media: [
          {
            mediaId: "3bb3ba5f-06ae-4f5e-a6ce-45cb62cc87ab",
            sortOrder: 0,
            isPrimary: true
          }
        ]
      }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      error: "One or more selected media uploads are incomplete."
    });
    expect(createAdventureMock).not.toHaveBeenCalled();

    await app.close();
  });
});
