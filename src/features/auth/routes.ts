import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

import { requireAuthenticatedRequest } from "./plugin.js";
import {
  HandleUnavailableError,
  bootstrapAuthenticatedIdentity,
  completeHandleSelection
} from "./service.js";

const handleSelectionBodySchema = z.object({
  handle: z
    .string()
    .trim()
    .min(3, "Handle must be 3 to 64 characters.")
    .max(64, "Handle must be 3 to 64 characters.")
    .regex(/^[a-z0-9_]+$/i, "Handle must contain only letters, numbers, or underscores.")
});

function handleSelectionValidationMessage(error: z.ZodError): string {
  for (const issue of error.issues) {
    if (issue.path.join(".") !== "handle") {
      continue;
    }

    if (issue.code === "too_small" || issue.code === "too_big") {
      return "Handle must be 3 to 64 characters.";
    }

    return issue.message;
  }

  return "Enter a valid handle and try again.";
}

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
  app.addHook("preHandler", requireAuthenticatedRequest);

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

    const parsedBody = handleSelectionBodySchema.safeParse(request.body);
    if (!parsedBody.success) {
      return reply.code(400).send({
        error: handleSelectionValidationMessage(parsedBody.error),
        details: parsedBody.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message
        }))
      });
    }

    try {
      return await completeHandleSelection(identity, parsedBody.data.handle);
    } catch (error) {
      if (error instanceof HandleUnavailableError) {
        return reply.code(409).send({
          error: "That handle is already taken. Try a different one."
        });
      }

      throw error;
    }
  });
}
