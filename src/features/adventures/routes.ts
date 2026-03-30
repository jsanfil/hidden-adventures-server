import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { requireAuthenticatedRequest } from "../auth/plugin.js";
import { getAdventureById, listFeed } from "./repository.js";

const feedQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  offset: z.coerce.number().int().min(0).default(0)
}).strict();

const detailQuerySchema = z.object({}).strict();

const detailParamsSchema = z.object({
  id: z.string().uuid()
});

export async function adventureRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireAuthenticatedRequest);

  app.get("/feed", async (request) => {
    const query = feedQuerySchema.parse(request.query);
    const items = await listFeed({
      viewerId: request.authContext?.viewer?.id,
      limit: query.limit,
      offset: query.offset
    });

    return {
      items,
      paging: {
        limit: query.limit,
        offset: query.offset,
        returned: items.length
      }
    };
  });

  app.get("/adventures/:id", async (request, reply) => {
    detailQuerySchema.parse(request.query);
    const params = detailParamsSchema.parse(request.params);
    const adventure = await getAdventureById({
      adventureId: params.id,
      viewerId: request.authContext?.viewer?.id
    });

    if (!adventure) {
      return reply.code(404).send({
        error: "Adventure not found."
      });
    }

    return {
      item: adventure
    };
  });
}
