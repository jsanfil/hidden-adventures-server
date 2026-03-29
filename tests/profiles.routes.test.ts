import Fastify from "fastify";
import { ZodError } from "zod";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getProfileByHandleMock, listProfileAdventuresMock } = vi.hoisted(() => ({
  getProfileByHandleMock: vi.fn(),
  listProfileAdventuresMock: vi.fn()
}));

vi.mock("../src/features/profiles/repository.js", () => ({
  getProfileByHandle: getProfileByHandleMock,
  listProfileAdventures: listProfileAdventuresMock
}));

import { profileRoutes } from "../src/features/profiles/routes.js";

async function buildProfileRouteApp(viewerId?: string) {
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

  await app.register(profileRoutes, { prefix: "/api" });
  return app;
}

describe("profile routes", () => {
  beforeEach(() => {
    getProfileByHandleMock.mockReset();
    listProfileAdventuresMock.mockReset();
  });

  it("resolves public profiles by handle and passes viewerId to authored adventure reads", async () => {
    getProfileByHandleMock.mockResolvedValue({
      id: "user-1",
      handle: "jacksanfil",
      displayName: "Jack",
      bio: "Explorer",
      homeCity: "Los Angeles",
      homeRegion: "CA",
      avatar: null,
      cover: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-03-01T00:00:00.000Z"
    });
    listProfileAdventuresMock.mockResolvedValue([
      {
        id: "adventure-1",
        title: "Quiet Ridge",
        summary: "Best at sunset.",
        body: null,
        categorySlug: "viewpoints",
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

    const app = await buildProfileRouteApp("viewer-123");

    const response = await app.inject({
      method: "GET",
      url: "/api/profiles/jacksanfil?limit=1&offset=0"
    });

    expect(response.statusCode).toBe(200);
    expect(getProfileByHandleMock).toHaveBeenCalledWith("jacksanfil");
    expect(listProfileAdventuresMock).toHaveBeenCalledWith({
      profileHandle: "jacksanfil",
      viewerId: "viewer-123",
      limit: 1,
      offset: 0
    });
    expect(response.json()).toEqual({
      profile: expect.objectContaining({
        handle: "jacksanfil"
      }),
      adventures: [
        expect.objectContaining({
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

  it("returns 404 for an unknown handle", async () => {
    getProfileByHandleMock.mockResolvedValue(null);

    const app = await buildProfileRouteApp("viewer-123");

    const response = await app.inject({
      method: "GET",
      url: "/api/profiles/missing-user"
    });

    expect(response.statusCode).toBe(404);
    expect(listProfileAdventuresMock).not.toHaveBeenCalled();

    await app.close();
  });

  it("rejects handle-based viewer query params", async () => {
    const app = await buildProfileRouteApp("viewer-123");

    const response = await app.inject({
      method: "GET",
      url: "/api/profiles/jacksanfil?viewerHandle=asanfil"
    });

    expect(response.statusCode).toBe(400);
    expect(getProfileByHandleMock).not.toHaveBeenCalled();
    expect(listProfileAdventuresMock).not.toHaveBeenCalled();

    await app.close();
  });
});
