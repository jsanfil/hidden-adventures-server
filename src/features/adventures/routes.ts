import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { env } from "../../config/env.js";
import { db } from "../../db/client.js";
import { requireAuthenticatedRequest } from "../auth/plugin.js";
import { listOwnedMediaAssetsForAdventureCreate } from "../media/repository.js";
import { checkMediaObjectExists } from "../media/storage.js";
import {
  createAdventure,
  createAdventureComment,
  deleteAdventureFavorite,
  deleteAdventureRating,
  getAdventureById,
  insertAdventureFavorite,
  listAdventureComments,
  listAdventureMedia,
  listFeed,
  upsertAdventureRating
} from "./repository.js";
import { toStoredAdventureVisibility } from "./visibility.js";

const feedQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  offset: z.coerce.number().int().min(0).default(0),
  latitude: z.coerce.number().min(-90).max(90).optional(),
  longitude: z.coerce.number().min(-180).max(180).optional(),
  radiusMiles: z.coerce.number().min(1).max(100).default(25),
  sort: z.enum(["recent", "distance"]).optional()
}).strict().superRefine((value, ctx) => {
  const hasLatitude = value.latitude !== undefined;
  const hasLongitude = value.longitude !== undefined;

  if (hasLatitude !== hasLongitude) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: hasLatitude ? ["longitude"] : ["latitude"],
      message: "latitude and longitude must be provided together."
    });
  }

  if (!hasLatitude && value.sort === "distance") {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["sort"],
      message: "sort=distance requires latitude and longitude."
    });
  }
});

const detailQuerySchema = z.object({}).strict();

const commentsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  offset: z.coerce.number().int().min(0).default(0)
}).strict();

const detailParamsSchema = z.object({
  id: z.string().uuid()
});

const createCommentBodySchema = z.object({
  body: z.string().trim().min(1).max(2_000)
}).strict();

const emptyBodySchema = z.object({}).strict();

const upsertRatingBodySchema = z.object({
  score: z.number().int().min(1).max(5)
}).strict();

const createAdventureBodySchema = z.object({
  title: z.string().trim().min(1).max(160),
  description: z.string().trim().max(5_000).optional().nullable(),
  categorySlug: z.enum([
    "viewpoints",
    "trails",
    "water_spots",
    "food_drink",
    "abandoned_places",
    "caves",
    "nature_escapes",
    "roadside_stops"
  ]).optional().nullable(),
  visibility: z.enum(["private", "sidekicks", "public"]),
  location: z.object({
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180)
  }).strict().optional().nullable(),
  placeLabel: z.string().trim().max(160).optional().nullable(),
  media: z.array(
    z.object({
      mediaId: z.string().uuid(),
      sortOrder: z.number().int().min(0).max(99),
      isPrimary: z.boolean()
    }).strict()
  ).min(1).max(20)
}).strict().superRefine((value, ctx) => {
  const sortOrders = new Set<number>();
  const mediaIds = new Set<string>();
  let primaryCount = 0;

  for (const [index, item] of value.media.entries()) {
    if (sortOrders.has(item.sortOrder)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["media", index, "sortOrder"],
        message: "sortOrder values must be unique."
      });
    }
    sortOrders.add(item.sortOrder);

    if (mediaIds.has(item.mediaId)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["media", index, "mediaId"],
        message: "mediaId values must be unique."
      });
    }
    mediaIds.add(item.mediaId);

    if (item.isPrimary) {
      primaryCount += 1;
    }
  }

  if (primaryCount !== 1) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["media"],
      message: "Exactly one media item must be marked primary."
    });
  }
});

export async function adventureRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireAuthenticatedRequest);

  app.get("/feed", async (request) => {
    const query = feedQuerySchema.parse(request.query);
    const result = await listFeed({
      viewerId: request.authContext?.viewer?.id,
      limit: query.limit,
      offset: query.offset,
      latitude: query.latitude,
      longitude: query.longitude,
      radiusMiles: query.latitude !== undefined ? query.radiusMiles : undefined,
      sort: query.sort
    });

    return {
      ...(result.scope ? { scope: result.scope } : {}),
      items: result.items,
      paging: {
        limit: query.limit,
        offset: query.offset,
        returned: result.items.length
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

  app.get("/adventures/:id/comments", async (request, reply) => {
    const query = commentsQuerySchema.parse(request.query);
    const params = detailParamsSchema.parse(request.params);
    const comments = await listAdventureComments({
      adventureId: params.id,
      viewerId: request.authContext?.viewer?.id,
      limit: query.limit,
      offset: query.offset
    });

    if (!comments) {
      return reply.code(404).send({
        error: "Adventure not found."
      });
    }

    return {
      items: comments,
      paging: {
        limit: query.limit,
        offset: query.offset,
        returned: comments.length
      }
    };
  });

  app.post("/adventures/:id/comments", async (request, reply) => {
    const viewer = request.authContext?.viewer;
    if (!viewer) {
      return reply.code(403).send({
        error: "Adventure comments require a completed local account."
      });
    }

    detailQuerySchema.parse(request.query);
    const params = detailParamsSchema.parse(request.params);
    const body = createCommentBodySchema.parse(request.body);
    const comment = await createAdventureComment({
      adventureId: params.id,
      authorUserId: viewer.id,
      body: body.body
    });

    if (!comment) {
      return reply.code(404).send({
        error: "Adventure not found."
      });
    }

    return reply.code(201).send({
      item: comment
    });
  });

  app.post("/adventures/:id/rating", async (request, reply) => {
    const viewer = request.authContext?.viewer;
    if (!viewer) {
      return reply.code(403).send({
        error: "Adventure ratings require a completed local account."
      });
    }

    detailQuerySchema.parse(request.query);
    const params = detailParamsSchema.parse(request.params);
    const body = upsertRatingBodySchema.parse(request.body);
    const adventure = await db.withTransaction((client) =>
      upsertAdventureRating(
        {
          viewerId: viewer.id,
          adventureId: params.id,
          score: body.score
        },
        client
      )
    );

    if (!adventure) {
      return reply.code(404).send({
        error: "Adventure not found."
      });
    }

    return {
      item: adventure
    };
  });

  app.delete("/adventures/:id/rating", async (request, reply) => {
    const viewer = request.authContext?.viewer;
    if (!viewer) {
      return reply.code(403).send({
        error: "Adventure ratings require a completed local account."
      });
    }

    detailQuerySchema.parse(request.query);
    emptyBodySchema.parse(request.body ?? {});
    const params = detailParamsSchema.parse(request.params);
    const adventure = await db.withTransaction((client) =>
      deleteAdventureRating(
        {
          viewerId: viewer.id,
          adventureId: params.id
        },
        client
      )
    );

    if (!adventure) {
      return reply.code(404).send({
        error: "Adventure not found."
      });
    }

    return {
      item: adventure
    };
  });

  app.post("/adventures/:id/favorite", async (request, reply) => {
    const viewer = request.authContext?.viewer;
    if (!viewer) {
      return reply.code(403).send({
        error: "Adventure favorites require a completed local account."
      });
    }

    detailQuerySchema.parse(request.query);
    const params = detailParamsSchema.parse(request.params);
    const adventure = await insertAdventureFavorite({
      viewerId: viewer.id,
      adventureId: params.id
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

  app.delete("/adventures/:id/favorite", async (request, reply) => {
    const viewer = request.authContext?.viewer;
    if (!viewer) {
      return reply.code(403).send({
        error: "Adventure favorites require a completed local account."
      });
    }

    detailQuerySchema.parse(request.query);
    const params = detailParamsSchema.parse(request.params);
    const adventure = await deleteAdventureFavorite({
      viewerId: viewer.id,
      adventureId: params.id
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

  app.post("/adventures", async (request, reply) => {
    const viewer = request.authContext?.viewer;
    if (!viewer) {
      return reply.code(403).send({
        error: "Adventure creation requires a completed local account."
      });
    }

    if (!env.S3_BUCKET) {
      request.log.error("S3_BUCKET is required for adventure creation.");
      return reply.code(503).send({
        error: "Adventure creation is unavailable."
      });
    }

    const body = createAdventureBodySchema.parse(request.body);
    const ownedMedia = await listOwnedMediaAssetsForAdventureCreate({
      ownerUserId: viewer.id,
      mediaIds: body.media.map((item) => item.mediaId)
    });

    if (ownedMedia.length !== body.media.length) {
      return reply.code(400).send({
        error: "One or more selected media items are unavailable."
      });
    }

    if (ownedMedia.some((item) => item.alreadyAttached)) {
      return reply.code(400).send({
        error: "One or more selected media items are already attached to an adventure."
      });
    }

    const uploadedResults = await Promise.all(
      ownedMedia.map(async (item) => ({
        mediaId: item.id,
        exists: await checkMediaObjectExists({
          bucket: env.S3_BUCKET!,
          key: item.storageKey,
          region: env.AWS_REGION
        })
      }))
    );

    if (uploadedResults.some((result) => result.exists === false)) {
      return reply.code(400).send({
        error: "One or more selected media uploads are incomplete."
      });
    }

    const created = await db.withTransaction((client) =>
      createAdventure(
        {
          authorUserId: viewer.id,
          title: body.title,
          description: body.description?.trim() || null,
          categorySlug: body.categorySlug ?? null,
          visibility: toStoredAdventureVisibility(body.visibility),
          location: body.location ?? null,
          placeLabel: body.placeLabel?.trim() || null,
          media: body.media,
          status: "pending_moderation"
        },
        client
      )
    );

    return reply.code(201).send({
      item: created
    });
  });
}
