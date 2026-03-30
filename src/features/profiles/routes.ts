import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { requireAuthenticatedRequest } from "../auth/plugin.js";
import { getProfileByHandle, listProfileAdventures } from "./repository.js";

const profileParamsSchema = z.object({
  handle: z.string().trim().min(1).max(64)
});

const profileQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  offset: z.coerce.number().int().min(0).default(0)
}).strict();

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
}
