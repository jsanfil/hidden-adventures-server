import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { env } from "../../config/env.js";
import { requireAuthenticatedRequest } from "../auth/plugin.js";
import { fetchMediaObject } from "../media/storage.js";
import {
  getAdventureById,
  getMediaDeliveryTarget,
  listAdventureMedia,
  listFeed
} from "./repository.js";

const feedQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  offset: z.coerce.number().int().min(0).default(0)
}).strict();

const detailQuerySchema = z.object({}).strict();

const detailParamsSchema = z.object({
  id: z.string().uuid()
});

const mediaParamsSchema = z.object({
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

  app.get("/adventures/:id/media", async (request, reply) => {
    detailQuerySchema.parse(request.query);
    const params = detailParamsSchema.parse(request.params);
    const items = await listAdventureMedia({
      adventureId: params.id,
      viewerId: request.authContext?.viewer?.id
    });

    if (!items) {
      return reply.code(404).send({
        error: "Adventure not found."
      });
    }

    return {
      items
    };
  });

  app.get("/media/:id", async (request, reply) => {
    const params = mediaParamsSchema.parse(request.params);
    const media = await getMediaDeliveryTarget({
      mediaId: params.id,
      viewerId: request.authContext?.viewer?.id
    });

    if (!media) {
      return reply.code(404).send({
        error: "Media not found."
      });
    }

    if (!env.S3_BUCKET) {
      request.log.error("S3_BUCKET is required for media delivery.");
      return reply.code(503).send({
        error: "Media delivery is unavailable."
      });
    }

    const object = await fetchMediaObject({
      bucket: env.S3_BUCKET,
      key: media.storageKey,
      region: env.AWS_REGION
    });

    const etag = object.etag ?? `W/"${media.id}:${media.updatedAt}"`;
    if (request.headers["if-none-match"] === etag) {
      return reply
        .code(304)
        .header("etag", etag)
        .header("cache-control", "private, max-age=300")
        .send();
    }

    return reply
      .header("content-type", object.contentType ?? media.mimeType ?? "application/octet-stream")
      .header("cache-control", "private, max-age=300")
      .header("etag", etag)
      .header("content-length", object.contentLength ?? media.byteSize ?? object.body.length)
      .send(object.body);
  });
}
