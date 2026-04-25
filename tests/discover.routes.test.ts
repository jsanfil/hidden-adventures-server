import Fastify from "fastify";
import { ZodError } from "zod";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { localIdentityFixtures } from "../src/features/auth/local-fixtures.js";

const {
  listDiscoverHomeMock,
  searchDiscoverMock
} = vi.hoisted(() => ({
  listDiscoverHomeMock: vi.fn(),
  searchDiscoverMock: vi.fn()
}));

vi.mock("../src/config/env.js", () => ({
  env: {
    AUTH_MODE: "local_identity",
    SERVER_RUNTIME_MODE: "local_automation_test_core"
  }
}));

vi.mock("../src/features/discover/repository.js", () => ({
  listDiscoverHome: listDiscoverHomeMock,
  searchDiscover: searchDiscoverMock
}));

import { discoverRoutes } from "../src/features/discover/routes.js";

async function buildDiscoverRouteApp(viewerId?: string) {
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

  await app.register(discoverRoutes, { prefix: "/api" });
  return app;
}

describe("discover routes", () => {
  beforeEach(() => {
    listDiscoverHomeMock.mockReset();
    searchDiscoverMock.mockReset();
  });

  it("requires auth for discover home reads", async () => {
    const app = await buildDiscoverRouteApp();

    const response = await app.inject({
      method: "GET",
      url: "/api/discover/home"
    });

    expect(response.statusCode).toBe(401);
    expect(listDiscoverHomeMock).not.toHaveBeenCalled();

    await app.close();
  });

  it("returns the discover home modules envelope", async () => {
    listDiscoverHomeMock.mockResolvedValue({
      modules: [
        {
          id: "explore-adventurers",
          type: "adventurers",
          title: "Explore Adventurers",
          items: []
        },
        {
          id: "popular-adventures",
          type: "adventures",
          title: "Popular Adventures",
          items: []
        }
      ]
    });

    const app = await buildDiscoverRouteApp(localIdentityFixtures.connected_viewer.seededUser?.id);
    const response = await app.inject({
      method: "GET",
      url: "/api/discover/home"
    });

    expect(response.statusCode).toBe(200);
    expect(listDiscoverHomeMock).toHaveBeenCalledWith();
    expect(response.json()).toEqual({
      modules: [
        {
          id: "explore-adventurers",
          type: "adventurers",
          title: "Explore Adventurers",
          items: []
        },
        {
          id: "popular-adventures",
          type: "adventures",
          title: "Popular Adventures",
          items: []
        }
      ]
    });

    await app.close();
  });

  it("returns grouped discover search results with paging", async () => {
    searchDiscoverMock.mockResolvedValue({
      query: "Maya",
      people: {
        items: []
      },
      adventures: {
        items: []
      }
    });

    const app = await buildDiscoverRouteApp(localIdentityFixtures.connected_viewer.seededUser?.id);
    const response = await app.inject({
      method: "GET",
      url: "/api/discover/search?q=Maya&limit=5&offset=10"
    });

    expect(response.statusCode).toBe(200);
    expect(searchDiscoverMock).toHaveBeenCalledWith({
      query: "Maya",
      limit: 5,
      offset: 10
    });
    expect(response.json()).toEqual({
      query: "Maya",
      people: {
        items: [],
        paging: {
          limit: 5,
          offset: 10,
          returned: 0
        }
      },
      adventures: {
        items: [],
        paging: {
          limit: 5,
          offset: 10,
          returned: 0
        }
      }
    });

    await app.close();
  });

  it("rejects empty or legacy discover search query params", async () => {
    const app = await buildDiscoverRouteApp(localIdentityFixtures.connected_viewer.seededUser?.id);

    const empty = await app.inject({
      method: "GET",
      url: "/api/discover/search?q=%20%20"
    });

    const legacy = await app.inject({
      method: "GET",
      url: "/api/discover/search?q=Maya&viewerHandle=legacy"
    });

    expect(empty.statusCode).toBe(400);
    expect(legacy.statusCode).toBe(400);

    await app.close();
  });
});
