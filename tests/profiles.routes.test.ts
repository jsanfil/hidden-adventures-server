import Fastify from "fastify";
import { ZodError } from "zod";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  localFixtureContent,
  localIdentityFixtures
} from "../src/features/auth/local-fixtures.js";

const {
  getProfileByHandleMock,
  getProfileByUserIdMock,
  listProfileAdventuresMock,
  updateMyProfileMock
} = vi.hoisted(() => ({
  getProfileByHandleMock: vi.fn(),
  getProfileByUserIdMock: vi.fn(),
  listProfileAdventuresMock: vi.fn(),
  updateMyProfileMock: vi.fn()
}));

vi.mock("../src/features/profiles/repository.js", () => ({
  getProfileByHandle: getProfileByHandleMock,
  getProfileByUserId: getProfileByUserIdMock,
  listProfileAdventures: listProfileAdventuresMock,
  updateMyProfile: updateMyProfileMock
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
          identity: localIdentityFixtures.connected_viewer.identity,
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
    getProfileByUserIdMock.mockReset();
    listProfileAdventuresMock.mockReset();
    updateMyProfileMock.mockReset();
  });

  it("requires auth for profile reads", async () => {
    const app = await buildProfileRouteApp();

    const response = await app.inject({
      method: "GET",
      url: `/api/profiles/${localFixtureContent.profileHandle}?limit=1&offset=0`
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({
      error: "Authentication required."
    });
    expect(getProfileByHandleMock).not.toHaveBeenCalled();
    expect(listProfileAdventuresMock).not.toHaveBeenCalled();

    await app.close();
  });

  it("resolves public profiles by handle and passes viewerId to authored adventure reads", async () => {
    getProfileByHandleMock.mockResolvedValue({
      id: "user-1",
      handle: localFixtureContent.profileHandle,
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
          handle: localFixtureContent.profileHandle,
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

    const app = await buildProfileRouteApp(localIdentityFixtures.connected_viewer.seededUser?.id);

    const response = await app.inject({
      method: "GET",
      url: `/api/profiles/${localFixtureContent.profileHandle}?limit=1&offset=0`
    });

    expect(response.statusCode).toBe(200);
    expect(getProfileByHandleMock).toHaveBeenCalledWith(localFixtureContent.profileHandle);
    expect(listProfileAdventuresMock).toHaveBeenCalledWith({
      profileHandle: localFixtureContent.profileHandle,
      viewerId: localIdentityFixtures.connected_viewer.seededUser?.id,
      limit: 1,
      offset: 0
    });
    expect(response.json()).toEqual({
      profile: expect.objectContaining({
        handle: localFixtureContent.profileHandle
      }),
      adventures: [
        expect.objectContaining({
          author: expect.objectContaining({
            handle: localFixtureContent.profileHandle
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

    const app = await buildProfileRouteApp(localIdentityFixtures.connected_viewer.seededUser?.id);

    const response = await app.inject({
      method: "GET",
      url: "/api/profiles/missing-user"
    });

    expect(response.statusCode).toBe(404);
    expect(listProfileAdventuresMock).not.toHaveBeenCalled();

    await app.close();
  });

  it("rejects handle-based viewer query params", async () => {
    const app = await buildProfileRouteApp(localIdentityFixtures.connected_viewer.seededUser?.id);

    const response = await app.inject({
      method: "GET",
      url: `/api/profiles/${localFixtureContent.profileHandle}?viewerHandle=asanfil`
    });

    expect(response.statusCode).toBe(400);
    expect(getProfileByHandleMock).not.toHaveBeenCalled();
    expect(listProfileAdventuresMock).not.toHaveBeenCalled();

    await app.close();
  });

  it("reads the authenticated viewer profile from /me/profile", async () => {
    getProfileByUserIdMock.mockResolvedValue({
      id: "user-1",
      handle: "viewer_handle",
      displayName: "Viewer",
      bio: "Test",
      homeCity: "Portland",
      homeRegion: "OR",
      avatar: null,
      cover: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-03-01T00:00:00.000Z"
    });

    const app = await buildProfileRouteApp(localIdentityFixtures.connected_viewer.seededUser?.id);

    const response = await app.inject({
      method: "GET",
      url: "/api/me/profile"
    });

    expect(response.statusCode).toBe(200);
    expect(getProfileByUserIdMock).toHaveBeenCalledWith(
      localIdentityFixtures.connected_viewer.seededUser?.id
    );
    expect(response.json()).toEqual({
      profile: expect.objectContaining({
        handle: "viewer_handle"
      })
    });

    await app.close();
  });

  it("requires auth for /me/profile reads", async () => {
    const app = await buildProfileRouteApp();

    const response = await app.inject({
      method: "GET",
      url: "/api/me/profile"
    });

    expect(response.statusCode).toBe(401);
    expect(getProfileByUserIdMock).not.toHaveBeenCalled();

    await app.close();
  });

  it("updates the authenticated viewer profile", async () => {
    updateMyProfileMock.mockResolvedValue({
      id: "user-1",
      handle: "viewer_handle",
      displayName: "Viewer",
      bio: "Updated bio",
      homeCity: "Seattle",
      homeRegion: "WA",
      avatar: null,
      cover: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-03-02T00:00:00.000Z"
    });

    const app = await buildProfileRouteApp(localIdentityFixtures.connected_viewer.seededUser?.id);

    const response = await app.inject({
      method: "PUT",
      url: "/api/me/profile",
      payload: {
        displayName: " Viewer ",
        bio: "Updated bio",
        homeCity: "Seattle",
        homeRegion: "WA"
      }
    });

    expect(response.statusCode).toBe(200);
    expect(updateMyProfileMock).toHaveBeenCalledWith(
      localIdentityFixtures.connected_viewer.seededUser?.id,
      {
        displayName: " Viewer ",
        bio: "Updated bio",
        homeCity: "Seattle",
        homeRegion: "WA"
      }
    );
    expect(response.json()).toEqual({
      profile: expect.objectContaining({
        homeRegion: "WA"
      })
    });

    await app.close();
  });

  it("rejects invalid /me/profile payloads", async () => {
    const app = await buildProfileRouteApp(localIdentityFixtures.connected_viewer.seededUser?.id);

    const response = await app.inject({
      method: "PUT",
      url: "/api/me/profile",
      payload: {
        displayName: ["wrong type"]
      }
    });

    expect(response.statusCode).toBe(400);
    expect(updateMyProfileMock).not.toHaveBeenCalled();

    await app.close();
  });
});
