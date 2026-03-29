import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

import {
  HandleUnavailableError,
  bootstrapAuthenticatedIdentity,
  completeHandleSelection
} from "./service.js";

const handleSelectionBodySchema = z.object({
  handle: z
    .string()
    .trim()
    .min(3)
    .max(64)
    .regex(/^[a-z0-9_]+$/i, "Handle must contain only letters, numbers, or underscores.")
});

function requireAuthenticatedIdentity(request: FastifyRequest, reply: FastifyReply) {
  const identity = request.authContext?.identity;
  if (!identity) {
    reply.code(401).send({
      error: "Authentication required."
    });
    return null;
  }

  return identity;
}

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.get("/auth/bootstrap", async (request, reply) => {
    const identity = requireAuthenticatedIdentity(request, reply);
    if (!identity) {
      return reply;
    }

    return bootstrapAuthenticatedIdentity(identity);
  });

  app.post("/auth/handle", async (request, reply) => {
    const identity = requireAuthenticatedIdentity(request, reply);
    if (!identity) {
      return reply;
    }

    const body = handleSelectionBodySchema.parse(request.body);

    try {
      return await completeHandleSelection(identity, body.handle);
    } catch (error) {
      if (error instanceof HandleUnavailableError) {
        return reply.code(409).send({
          error: "Handle unavailable."
        });
      }

      throw error;
    }
  });
}
