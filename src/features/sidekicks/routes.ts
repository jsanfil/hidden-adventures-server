import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

import { db } from "../../db/client.js";
import { requireAuthenticatedRequest } from "../auth/plugin.js";
import {
  addSidekickGrant,
  listDiscoveredProfiles,
  listMySidekicks,
  removeSidekickGrant,
  searchProfiles
} from "./repository.js";

const pagingQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  offset: z.coerce.number().int().min(0).default(0)
}).strict();

const searchQuerySchema = pagingQuerySchema.extend({
  q: z.string().trim().min(1)
}).strict();

const handleParamsSchema = z.object({
  handle: z.string().trim().min(1).max(64)
});

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

export async function sidekickRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireAuthenticatedRequest);

  app.get("/me/sidekicks", async (request, reply) => {
    const viewer = requireViewer(request, reply);
    if (!viewer) {
      return reply;
    }

    const query = pagingQuerySchema.parse(request.query);
    const items = await listMySidekicks({
      viewerId: viewer.id,
      limit: query.limit,
      offset: query.offset
    });

    return {
      items,
      paging: paging(query.limit, query.offset, items.length)
    };
  });

  app.get("/sidekicks/discover", async (request, reply) => {
    const viewer = requireViewer(request, reply);
    if (!viewer) {
      return reply;
    }

    const query = pagingQuerySchema.parse(request.query);
    const items = await listDiscoveredProfiles({
      viewerId: viewer.id,
      limit: query.limit,
      offset: query.offset
    });

    return {
      items,
      paging: paging(query.limit, query.offset, items.length)
    };
  });

  app.get("/sidekicks/search", async (request, reply) => {
    const viewer = requireViewer(request, reply);
    if (!viewer) {
      return reply;
    }

    const query = searchQuerySchema.parse(request.query);
    const items = await searchProfiles({
      viewerId: viewer.id,
      query: query.q,
      limit: query.limit,
      offset: query.offset
    });

    return {
      items,
      paging: paging(query.limit, query.offset, items.length),
      query: query.q
    };
  });

  app.post("/me/sidekicks/:handle", async (request, reply) => {
    const viewer = requireViewer(request, reply);
    if (!viewer) {
      return reply;
    }

    const params = handleParamsSchema.parse(request.params);
    if (params.handle === request.authContext?.viewer?.handle) {
      return reply.code(400).send({
        error: "You cannot add yourself as a sidekick."
      });
    }

    const item = await db.withTransaction((client) =>
      addSidekickGrant(
        {
          viewerId: viewer.id,
          handle: params.handle
        },
        client
      )
    );

    if (!item) {
      return reply.code(404).send({
        error: "Profile not found."
      });
    }

    return {
      item
    };
  });

  app.delete("/me/sidekicks/:handle", async (request, reply) => {
    const viewer = requireViewer(request, reply);
    if (!viewer) {
      return reply;
    }

    const params = handleParamsSchema.parse(request.params);
    if (params.handle === request.authContext?.viewer?.handle) {
      return reply.code(400).send({
        error: "You cannot remove yourself as a sidekick."
      });
    }

    const item = await db.withTransaction((client) =>
      removeSidekickGrant(
        {
          viewerId: viewer.id,
          handle: params.handle
        },
        client
      )
    );

    if (!item) {
      return reply.code(404).send({
        error: "Profile not found."
      });
    }

    return {
      item
    };
  });
}
