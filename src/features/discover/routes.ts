import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

import { requireAuthenticatedRequest } from "../auth/plugin.js";
import { listDiscoverHome, searchDiscover } from "./repository.js";

const searchQuerySchema = z.object({
  q: z.string().trim().min(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  offset: z.coerce.number().int().min(0).default(0)
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

function paging(limit: number, offset: number, returned: number) {
  return {
    limit,
    offset,
    returned
  };
}

export async function discoverRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireAuthenticatedRequest);

  app.get("/discover/home", async (request, reply) => {
    const viewer = requireViewer(request, reply);
    if (!viewer) {
      return reply;
    }

    return listDiscoverHome();
  });

  app.get("/discover/search", async (request, reply) => {
    const viewer = requireViewer(request, reply);
    if (!viewer) {
      return reply;
    }

    const query = searchQuerySchema.parse(request.query);
    const result = await searchDiscover({
      query: query.q,
      limit: query.limit,
      offset: query.offset
    });

    return {
      query: result.query,
      people: {
        items: result.people.items,
        paging: paging(query.limit, query.offset, result.people.items.length)
      },
      adventures: {
        items: result.adventures.items,
        paging: paging(query.limit, query.offset, result.adventures.items.length)
      }
    };
  });
}
