import { randomUUID } from "node:crypto";

import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { env } from "../../config/env.js";
import { requireAuthenticatedRequest } from "../auth/plugin.js";
import { getMediaDeliveryTarget, insertPendingMediaAssets } from "./repository.js";
import {
  buildAdventureImageStorageKey,
  fetchMediaObject,
  createPresignedUpload,
  normalizeAdventureImageMimeType
} from "./storage.js";

const uploadItemSchema = z.object({
  clientId: z.string().trim().min(1).max(128),
  mimeType: z.string().trim().min(1).max(128),
  byteSize: z.coerce.number().int().positive().max(25 * 1024 * 1024),
  width: z.coerce.number().int().positive().max(20_000).optional(),
  height: z.coerce.number().int().positive().max(20_000).optional()
}).strict();

const uploadRequestSchema = z.object({
  items: z.array(uploadItemSchema).min(1).max(20)
}).strict();

const mediaParamsSchema = z.object({
  id: z.string().uuid()
});

export async function mediaRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireAuthenticatedRequest);

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

  app.post("/media/adventure-uploads", async (request, reply) => {
    const viewer = request.authContext?.viewer;
    if (!viewer) {
      return reply.code(403).send({
        error: "Adventure uploads require a completed local account."
      });
    }

    if (!env.S3_BUCKET) {
      request.log.error("S3_BUCKET is required for upload allocation.");
      return reply.code(503).send({
        error: "Media upload is unavailable."
      });
    }

    const body = uploadRequestSchema.parse(request.body);
    const seenClientIds = new Set<string>();
    for (const item of body.items) {
      if (seenClientIds.has(item.clientId)) {
        return reply.code(400).send({
          error: "Upload clientIds must be unique."
        });
      }
      seenClientIds.add(item.clientId);
    }

    const allocations = await Promise.all(
      body.items.map(async (item) => {
        const mediaId = randomUUID();
        const normalized = normalizeAdventureImageMimeType(item.mimeType);
        const storageKey = buildAdventureImageStorageKey({
          handle: viewer.handle,
          mediaId,
          extension: normalized.extension
        });
        const upload = await createPresignedUpload({
          bucket: env.S3_BUCKET!,
          key: storageKey,
          region: env.AWS_REGION,
          contentType: normalized.mimeType
        });

        return {
          clientId: item.clientId,
          mediaId,
          storageKey,
          mimeType: normalized.mimeType,
          byteSize: item.byteSize,
          width: item.width ?? null,
          height: item.height ?? null,
          upload
        };
      })
    );

    await insertPendingMediaAssets(
      allocations.map((allocation) => ({
        id: allocation.mediaId,
        ownerUserId: viewer.id,
        storageKey: allocation.storageKey,
        kind: "adventure_image",
        mimeType: allocation.mimeType,
        byteSize: allocation.byteSize,
        width: allocation.width,
        height: allocation.height
      }))
    );

    return {
      items: allocations.map((allocation) => ({
        clientId: allocation.clientId,
        mediaId: allocation.mediaId,
        storageKey: allocation.storageKey,
        upload: allocation.upload
      }))
    };
  });
}
