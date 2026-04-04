import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

import { requireAuthenticatedRequest } from "../auth/plugin.js";
import {
  getProfileByHandle,
  getProfileByUserId,
  listProfileAdventures,
  updateMyProfile,
  type MeProfileUpdateRequest
} from "./repository.js";

const profileParamsSchema = z.object({
  handle: z.string().trim().min(1).max(64)
});

const profileQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  offset: z.coerce.number().int().min(0).default(0)
}).strict();

const meProfileUpdateBodySchema = z.object({
  displayName: z.string().nullable().optional().default(null),
  bio: z.string().nullable().optional().default(null),
  homeCity: z.string().nullable().optional().default(null),
  homeRegion: z.string().nullable().optional().default(null)
}).strict();

function requireViewer(request: FastifyRequest, reply: FastifyReply) {
  const viewer = request.authContext?.viewer;
  if (!viewer) {
    reply.code(401).send({
      error: "Authentication required."
    });
    return null;
  }

  return viewer;
}

export async function profileRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireAuthenticatedRequest);

  app.get("/profiles/:handle", async (request, reply) => {
    const params = profileParamsSchema.parse(request.params);
    const query = profileQuerySchema.parse(request.query);

    const profile = await getProfileByHandle(params.handle);
    if (!profile) {
      return reply.code(404).send({
        error: "Profile not found."
      });
    }

    const adventures = await listProfileAdventures({
      profileHandle: params.handle,
      viewerId: request.authContext?.viewer?.id,
      limit: query.limit,
      offset: query.offset
    });

    return {
      profile,
      adventures,
      paging: {
        limit: query.limit,
        offset: query.offset,
        returned: adventures.length
      }
    };
  });

  app.get("/me/profile", async (request, reply) => {
    const viewer = requireViewer(request, reply);
    if (!viewer) {
      return reply;
    }

    const profile = await getProfileByUserId(viewer.id);
    if (!profile) {
      return reply.code(404).send({
        error: "Profile not found."
      });
    }

    return {
      profile
    };
  });

  app.put("/me/profile", async (request, reply) => {
    const viewer = requireViewer(request, reply);
    if (!viewer) {
      return reply;
    }

    const body = meProfileUpdateBodySchema.parse(request.body) as MeProfileUpdateRequest;
    const profile = await updateMyProfile(viewer.id, body);
    if (!profile) {
      return reply.code(404).send({
        error: "Profile not found."
      });
    }

    return {
      profile
    };
  });
}
