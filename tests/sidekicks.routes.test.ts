import Fastify from "fastify";
import { ZodError } from "zod";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { localIdentityFixtures } from "../src/features/auth/local-fixtures.js";

const {
  dbMock,
  addSidekickGrantMock,
  listDiscoveredProfilesMock,
  listMySidekicksMock,
  removeSidekickGrantMock,
  searchProfilesMock
} = vi.hoisted(() => ({
  dbMock: {
    withTransaction: vi.fn()
  },
  addSidekickGrantMock: vi.fn(),
  listDiscoveredProfilesMock: vi.fn(),
  listMySidekicksMock: vi.fn(),
  removeSidekickGrantMock: vi.fn(),
  searchProfilesMock: vi.fn()
}));

vi.mock("../src/db/client.js", () => ({
  db: dbMock
}));

vi.mock("../src/features/sidekicks/repository.js", () => ({
  addSidekickGrant: addSidekickGrantMock,
  listDiscoveredProfiles: listDiscoveredProfilesMock,
  listMySidekicks: listMySidekicksMock,
  removeSidekickGrant: removeSidekickGrantMock,
  searchProfiles: searchProfilesMock
}));

import { sidekickRoutes } from "../src/features/sidekicks/routes.js";

async function buildSidekickRouteApp(viewer?: { id?: string; handle?: string }) {
  const app = Fastify();
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError) {
      return reply.code(400).send({ error: "Invalid request." });
    }

    throw error;
  });
  app.decorateRequest("authContext", null);
  app.addHook("onRequest", async (request) => {
    (request as typeof request & { authContext: unknown }).authContext = viewer?.id
      ? {
          identity: localIdentityFixtures.connected_viewer.identity,
          viewer: {
            id: viewer.id,
            handle: viewer.handle ?? "viewer"
          }
        }
      : null;
  });

  await app.register(sidekickRoutes, { prefix: "/api" });
  return app;
}

describe("sidekick routes", () => {
  beforeEach(() => {
    dbMock.withTransaction.mockReset();
    dbMock.withTransaction.mockImplementation(async (callback: (client: { query: typeof vi.fn }) => unknown) =>
      callback({ query: vi.fn() })
    );
    addSidekickGrantMock.mockReset();
    listDiscoveredProfilesMock.mockReset();
    listMySidekicksMock.mockReset();
    removeSidekickGrantMock.mockReset();
    searchProfilesMock.mockReset();
  });

  it("requires auth for my sidekicks reads", async () => {
    const app = await buildSidekickRouteApp();
    const response = await app.inject({ method: "GET", url: "/api/me/sidekicks" });

    expect(response.statusCode).toBe(401);
    expect(listMySidekicksMock).not.toHaveBeenCalled();

    await app.close();
  });

  it("lists outbound sidekicks for the viewer", async () => {
    listMySidekicksMock.mockResolvedValue([{ profile: { id: "u1", handle: "maya", displayName: "Maya", bio: null, homeCity: null, homeRegion: null, avatar: null }, relationship: { isSidekick: true }, stats: { adventuresCount: 3 } }]);

    const app = await buildSidekickRouteApp({
      id: localIdentityFixtures.connected_viewer.seededUser?.id,
      handle: localIdentityFixtures.connected_viewer.seededUser?.handle
    });
    const response = await app.inject({ method: "GET", url: "/api/me/sidekicks?limit=1&offset=0" });

    expect(response.statusCode).toBe(200);
    expect(listMySidekicksMock).toHaveBeenCalledWith({
      viewerId: localIdentityFixtures.connected_viewer.seededUser?.id,
      limit: 1,
      offset: 0
    });

    await app.close();
  });

  it("searches profiles with strict query validation", async () => {
    searchProfilesMock.mockResolvedValue([]);
    const app = await buildSidekickRouteApp({
      id: localIdentityFixtures.connected_viewer.seededUser?.id,
      handle: localIdentityFixtures.connected_viewer.seededUser?.handle
    });

    const response = await app.inject({
      method: "GET",
      url: "/api/sidekicks/search?q=Port&limit=5&offset=0"
    });

    expect(response.statusCode).toBe(200);
    expect(searchProfilesMock).toHaveBeenCalledWith({
      viewerId: localIdentityFixtures.connected_viewer.seededUser?.id,
      query: "Port",
      limit: 5,
      offset: 0
    });

    const invalid = await app.inject({
      method: "GET",
      url: "/api/sidekicks/search?q=Port&viewerHandle=legacy"
    });

    expect(invalid.statusCode).toBe(400);

    await app.close();
  });

  it("rejects empty trimmed search queries", async () => {
    const app = await buildSidekickRouteApp({
      id: localIdentityFixtures.connected_viewer.seededUser?.id,
      handle: localIdentityFixtures.connected_viewer.seededUser?.handle
    });
    const response = await app.inject({
      method: "GET",
      url: "/api/sidekicks/search?q=%20%20"
    });

    expect(response.statusCode).toBe(400);

    await app.close();
  });

  it("adds a sidekick grant and returns the updated item", async () => {
    addSidekickGrantMock.mockResolvedValue({
      profile: { id: "u2", handle: "maya", displayName: "Maya", bio: null, homeCity: null, homeRegion: null, avatar: null },
      relationship: { isSidekick: true },
      stats: { adventuresCount: 2 }
    });
    const app = await buildSidekickRouteApp({
      id: localIdentityFixtures.connected_viewer.seededUser?.id,
      handle: localIdentityFixtures.connected_viewer.seededUser?.handle
    });
    const response = await app.inject({ method: "POST", url: "/api/me/sidekicks/maya" });

    expect(response.statusCode).toBe(200);
    expect(addSidekickGrantMock).toHaveBeenCalled();

    await app.close();
  });

  it("rejects self-target add and remove requests", async () => {
    const handle = localIdentityFixtures.connected_viewer.seededUser?.handle ?? "connected_viewer";
    const app = await buildSidekickRouteApp({
      id: localIdentityFixtures.connected_viewer.seededUser?.id,
      handle
    });

    const addResponse = await app.inject({ method: "POST", url: `/api/me/sidekicks/${handle}` });
    const removeResponse = await app.inject({ method: "DELETE", url: `/api/me/sidekicks/${handle}` });

    expect(addResponse.statusCode).toBe(400);
    expect(removeResponse.statusCode).toBe(400);

    await app.close();
  });

  it("returns 404 when add/remove target handles do not resolve", async () => {
    addSidekickGrantMock.mockResolvedValue(null);
    removeSidekickGrantMock.mockResolvedValue(null);
    const app = await buildSidekickRouteApp({
      id: localIdentityFixtures.connected_viewer.seededUser?.id,
      handle: localIdentityFixtures.connected_viewer.seededUser?.handle
    });

    const addResponse = await app.inject({ method: "POST", url: "/api/me/sidekicks/missing" });
    const removeResponse = await app.inject({ method: "DELETE", url: "/api/me/sidekicks/missing" });

    expect(addResponse.statusCode).toBe(404);
    expect(removeResponse.statusCode).toBe(404);

    await app.close();
  });
});
