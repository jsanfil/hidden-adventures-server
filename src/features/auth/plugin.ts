import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import { env } from "../../config/env.js";
import { getUserByCognitoSubject, type LocalUser } from "./repository.js";
import { createIdentityVerifier } from "./verifier.js";
import type { AuthenticatedIdentity } from "./service.js";

export type AuthContext = {
  identity: AuthenticatedIdentity;
  viewer: LocalUser | null;
};

declare module "fastify" {
  interface FastifyRequest {
    authContext: AuthContext | null;
  }
}

function getBearerToken(request: FastifyRequest): string | null {
  const authorization = request.headers.authorization;
  if (!authorization) {
    return null;
  }

  const [scheme, token] = authorization.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !token) {
    return null;
  }

  return token.trim();
}

async function rejectUnauthorized(reply: FastifyReply, message: string) {
  return reply.code(401).send({
    error: message
  });
}

export async function requireAuthenticatedRequest(request: FastifyRequest, reply: FastifyReply) {
  if (request.authContext?.identity) {
    return;
  }

  return rejectUnauthorized(reply, "Authentication required.");
}

export async function authPlugin(app: FastifyInstance): Promise<void> {
  const verifyToken = createIdentityVerifier();
  app.decorateRequest("authContext", null);

  app.addHook("onRequest", async (request, reply) => {
    const token = getBearerToken(request);
    if (!token) {
      request.authContext = null;
      return;
    }

    try {
      const identity = await verifyToken(token);
      const viewer = await getUserByCognitoSubject(identity.sub);
      request.authContext = {
        identity,
        viewer
      };
    } catch (error) {
      request.log.warn({ err: error, authMode: env.AUTH_MODE }, "Failed to authenticate bearer token.");
      return rejectUnauthorized(reply, "Invalid authentication token.");
    }
  });
}
