import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { getAdventureById, listFeed } from "./repository.js";

const feedQuerySchema = z.object({
  viewerHandle: z.string().trim().min(1).max(64).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  offset: z.coerce.number().int().min(0).default(0)
});

const detailQuerySchema = z.object({
  viewerHandle: z.string().trim().min(1).max(64).optional()
});

const detailParamsSchema = z.object({
  id: z.string().uuid()
});

export async function adventureRoutes(app: FastifyInstance): Promise<void> {
  app.get("/feed", async (request, reply) => {
    const query = feedQuerySchema.parse(request.query);
    const items = await listFeed(query);

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
    const query = detailQuerySchema.parse(request.query);
    const params = detailParamsSchema.parse(request.params);
    const adventure = await getAdventureById({
      adventureId: params.id,
      viewerHandle: query.viewerHandle
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
