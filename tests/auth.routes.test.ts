import Fastify from "fastify";
import { ZodError } from "zod";
import { beforeEach, describe, expect, it, vi } from "vitest";

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
            id: "viewer-123"
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
    const identity = {
      sub: "sub-123",
      username: "legacyjack",
      email: "jack@example.com",
      emailVerified: true,
      tokenUse: "id" as const
    };
    bootstrapAuthenticatedIdentityMock.mockResolvedValue({
      accountState: "linked",
      user: {
        id: "user-1",
        handle: "legacyjack"
      },
      suggestedHandle: null,
      recoveryEmail: "jack@example.com"
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
        id: "user-1",
        handle: "legacyjack"
      },
      suggestedHandle: null,
      recoveryEmail: "jack@example.com"
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
    const app = await buildAuthRouteApp({
      sub: "sub-123",
      username: "legacyjack",
      email: "jack@example.com",
      emailVerified: true,
      tokenUse: "id"
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/auth/handle",
      payload: {
        handle: "no spaces allowed"
      }
    });

    expect(response.statusCode).toBe(400);
    expect(completeHandleSelectionMock).not.toHaveBeenCalled();

    await app.close();
  });

  it("passes the authenticated identity and requested handle into handle selection", async () => {
    const identity = {
      sub: "sub-new",
      username: "FreshUser",
      email: "fresh@example.com",
      emailVerified: true,
      tokenUse: "id" as const
    };
    completeHandleSelectionMock.mockResolvedValue({
      accountState: "linked",
      user: {
        id: "new-user-1",
        handle: "new_user"
      },
      suggestedHandle: null,
      recoveryEmail: "fresh@example.com"
    });

    const app = await buildAuthRouteApp(identity);

    const response = await app.inject({
      method: "POST",
      url: "/api/auth/handle",
      payload: {
        handle: "New_User"
      }
    });

    expect(response.statusCode).toBe(200);
    expect(completeHandleSelectionMock).toHaveBeenCalledWith(identity, "New_User");
    expect(response.json()).toEqual({
      accountState: "linked",
      user: {
        id: "new-user-1",
        handle: "new_user"
      },
      suggestedHandle: null,
      recoveryEmail: "fresh@example.com"
    });

    await app.close();
  });

  it("maps handle collisions to 409", async () => {
    completeHandleSelectionMock.mockRejectedValue(new HandleUnavailableError("taken_handle"));

    const app = await buildAuthRouteApp({
      sub: "sub-new",
      username: "FreshUser",
      email: "fresh@example.com",
      emailVerified: true,
      tokenUse: "id"
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/auth/handle",
      payload: {
        handle: "taken_handle"
      }
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({
      error: "Handle unavailable."
    });

    await app.close();
  });
});
