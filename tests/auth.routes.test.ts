import Fastify from "fastify";
import { ZodError } from "zod";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  LOCAL_FIXTURE_DEFAULT_HANDLE,
  localIdentityFixtures
} from "../src/features/auth/local-fixtures.js";
import { HandleUnavailableError } from "../src/features/auth/service.js";

const { bootstrapAuthenticatedIdentityMock, completeHandleSelectionMock } = vi.hoisted(() => ({
  bootstrapAuthenticatedIdentityMock: vi.fn(),
  completeHandleSelectionMock: vi.fn()
}));

vi.mock("../src/features/auth/service.js", async () => {
  const actual = await vi.importActual("../src/features/auth/service.js");

  return {
    ...actual,
    bootstrapAuthenticatedIdentity: bootstrapAuthenticatedIdentityMock,
    completeHandleSelection: completeHandleSelectionMock
  };
});

import { authRoutes } from "../src/features/auth/routes.js";

type AuthenticatedIdentity = {
  sub: string;
  username: string | null;
  email: string | null;
  emailVerified: boolean;
  tokenUse: "access" | "id";
};

async function buildAuthRouteApp(identity?: AuthenticatedIdentity) {
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
    (request as typeof request & { authContext: unknown }).authContext = identity
      ? {
          identity,
          viewer: {
            id: localIdentityFixtures.connected_viewer.seededUser?.id ?? "viewer-123"
          }
        }
      : null;
  });

  await app.register(authRoutes, { prefix: "/api" });
  return app;
}

describe("auth routes", () => {
  beforeEach(() => {
    bootstrapAuthenticatedIdentityMock.mockReset();
    completeHandleSelectionMock.mockReset();
  });

  it("requires an authenticated identity for auth bootstrap", async () => {
    const app = await buildAuthRouteApp();

    const response = await app.inject({
      method: "GET",
      url: "/api/auth/bootstrap"
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({
      error: "Authentication required."
    });
    expect(bootstrapAuthenticatedIdentityMock).not.toHaveBeenCalled();

    await app.close();
  });

  it("passes the authenticated identity into auth bootstrap", async () => {
    const identity = localIdentityFixtures.connected_viewer.identity;
    bootstrapAuthenticatedIdentityMock.mockResolvedValue({
      accountState: "linked",
      user: {
        id: localIdentityFixtures.connected_viewer.seededUser?.id,
        handle: localIdentityFixtures.connected_viewer.seededUser?.handle
      },
      suggestedHandle: null,
      recoveryEmail: localIdentityFixtures.connected_viewer.seededUser?.email
    });

    const app = await buildAuthRouteApp(identity);

    const response = await app.inject({
      method: "GET",
      url: "/api/auth/bootstrap"
    });

    expect(response.statusCode).toBe(200);
    expect(bootstrapAuthenticatedIdentityMock).toHaveBeenCalledWith(identity);
    expect(response.json()).toEqual({
      accountState: "linked",
      user: {
        id: localIdentityFixtures.connected_viewer.seededUser?.id,
        handle: localIdentityFixtures.connected_viewer.seededUser?.handle
      },
      suggestedHandle: null,
      recoveryEmail: localIdentityFixtures.connected_viewer.seededUser?.email
    });

    await app.close();
  });

  it("requires an authenticated identity for handle selection", async () => {
    const app = await buildAuthRouteApp();

    const response = await app.inject({
      method: "POST",
      url: "/api/auth/handle",
      payload: {
        handle: "freshslice1"
      }
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({
      error: "Authentication required."
    });
    expect(completeHandleSelectionMock).not.toHaveBeenCalled();

    await app.close();
  });

  it("rejects invalid handle payloads before calling the service", async () => {
    const app = await buildAuthRouteApp(localIdentityFixtures.connected_viewer.identity);

    const response = await app.inject({
      method: "POST",
      url: "/api/auth/handle",
      payload: {
        handle: "no spaces allowed"
      }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      error: "Handle must contain only letters, numbers, or underscores.",
      details: [
        {
          path: "handle",
          message: "Handle must contain only letters, numbers, or underscores."
        }
      ]
    });
    expect(completeHandleSelectionMock).not.toHaveBeenCalled();

    await app.close();
  });

  it("returns a friendly length validation message for short handles", async () => {
    const app = await buildAuthRouteApp(localIdentityFixtures.connected_viewer.identity);

    const response = await app.inject({
      method: "POST",
      url: "/api/auth/handle",
      payload: {
        handle: "ab"
      }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      error: "Handle must be 3 to 64 characters.",
      details: [
        {
          path: "handle",
          message: "Handle must be 3 to 64 characters."
        }
      ]
    });
    expect(completeHandleSelectionMock).not.toHaveBeenCalled();

    await app.close();
  });

  it("passes the authenticated identity and requested handle into handle selection", async () => {
    const identity = localIdentityFixtures.new_user.identity;
    completeHandleSelectionMock.mockResolvedValue({
      accountState: "linked",
      user: {
        id: "new-user-1",
        handle: LOCAL_FIXTURE_DEFAULT_HANDLE
      },
      suggestedHandle: null,
      recoveryEmail: localIdentityFixtures.new_user.identity.email
    });

    const app = await buildAuthRouteApp(identity);

    const response = await app.inject({
      method: "POST",
      url: "/api/auth/handle",
      payload: {
        handle: "Fixture_New_Handle"
      }
    });

    expect(response.statusCode).toBe(200);
    expect(completeHandleSelectionMock).toHaveBeenCalledWith(identity, "Fixture_New_Handle");
    expect(response.json()).toEqual({
      accountState: "linked",
      user: {
        id: "new-user-1",
        handle: LOCAL_FIXTURE_DEFAULT_HANDLE
      },
      suggestedHandle: null,
      recoveryEmail: localIdentityFixtures.new_user.identity.email
    });

    await app.close();
  });

  it("maps handle collisions to 409", async () => {
    completeHandleSelectionMock.mockRejectedValue(new HandleUnavailableError("taken_handle"));

    const app = await buildAuthRouteApp(localIdentityFixtures.new_user.identity);

    const response = await app.inject({
      method: "POST",
      url: "/api/auth/handle",
      payload: {
        handle: "taken_handle"
      }
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({
      error: "That handle is already taken. Try a different one."
    });

    await app.close();
  });
});
