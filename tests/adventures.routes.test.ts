import Fastify from "fastify";
import { ZodError } from "zod";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getAdventureByIdMock, listFeedMock } = vi.hoisted(() => ({
  getAdventureByIdMock: vi.fn(),
  listFeedMock: vi.fn()
}));

vi.mock("../src/features/adventures/repository.js", () => ({
  getAdventureById: getAdventureByIdMock,
  listFeed: listFeedMock
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
          identity: {
            sub: "sub-123",
            username: "legacyjack",
            email: "jack@example.com",
            emailVerified: true,
            tokenUse: "id"
          },
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
    listFeedMock.mockReset();
    getAdventureByIdMock.mockReset();
  });

  it("passes authContext.viewer.id into feed reads", async () => {
    listFeedMock.mockResolvedValue([
      {
        id: "adventure-1",
        title: "Hidden Falls",
        summary: "A short trail to a quiet waterfall.",
        body: "Bring water and wear good shoes.",
        categorySlug: "water_spots",
        visibility: "public",
        createdAt: "2026-03-01T00:00:00.000Z",
        publishedAt: "2026-03-02T00:00:00.000Z",
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
      }
    ]);

    const app = await buildAdventureRouteApp("viewer-123");

    const response = await app.inject({
      method: "GET",
      url: "/api/feed?limit=1&offset=0"
    });

    expect(response.statusCode).toBe(200);
    expect(listFeedMock).toHaveBeenCalledWith({
      viewerId: "viewer-123",
      limit: 1,
      offset: 0
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

  it("passes authContext.viewer.id into detail reads", async () => {
    getAdventureByIdMock.mockResolvedValue({
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

    const app = await buildAdventureRouteApp("viewer-123");

    const response = await app.inject({
      method: "GET",
      url: "/api/adventures/3bb3ba5f-06ae-4f5e-a6ce-45cb62cc87ab"
    });

    expect(response.statusCode).toBe(200);
    expect(getAdventureByIdMock).toHaveBeenCalledWith({
      adventureId: "3bb3ba5f-06ae-4f5e-a6ce-45cb62cc87ab",
      viewerId: "viewer-123"
    });

    await app.close();
  });

  it("rejects handle-based viewer query params", async () => {
    const app = await buildAdventureRouteApp("viewer-123");

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
});
