import Fastify from "fastify";
import { ZodError } from "zod";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { localIdentityFixtures } from "../src/features/auth/local-fixtures.js";

const { insertPendingMediaAssetsMock } = vi.hoisted(() => ({
  insertPendingMediaAssetsMock: vi.fn()
}));

const { buildAdventureImageStorageKeyMock, createPresignedUploadMock, normalizeAdventureImageMimeTypeMock } =
  vi.hoisted(() => ({
    buildAdventureImageStorageKeyMock: vi.fn(),
    createPresignedUploadMock: vi.fn(),
    normalizeAdventureImageMimeTypeMock: vi.fn()
  }));

vi.mock("../src/features/media/repository.js", () => ({
  insertPendingMediaAssets: insertPendingMediaAssetsMock
}));

vi.mock("../src/features/media/storage.js", () => ({
  buildAdventureImageStorageKey: buildAdventureImageStorageKeyMock,
  createPresignedUpload: createPresignedUploadMock,
  normalizeAdventureImageMimeType: normalizeAdventureImageMimeTypeMock
}));

vi.mock("../src/config/env.js", () => ({
  env: {
    AWS_REGION: "us-west-2",
    S3_BUCKET: "fixture-bucket"
  }
}));

import { mediaRoutes } from "../src/features/media/routes.js";

async function buildMediaRouteApp(viewer?: { id: string; handle: string }) {
  const app = Fastify();
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError) {
      return reply.code(400).send({
        error: "Invalid request."
      });
    }

    throw error;
  });
  app.decorateRequest("authContext", null);
  app.addHook("onRequest", async (request) => {
    (request as typeof request & { authContext: unknown }).authContext = viewer
      ? {
          identity: localIdentityFixtures.connected_viewer.identity,
          viewer
        }
      : null;
  });

  await app.register(mediaRoutes, { prefix: "/api" });
  return app;
}

describe("media routes", () => {
  beforeEach(() => {
    insertPendingMediaAssetsMock.mockReset();
    buildAdventureImageStorageKeyMock.mockReset();
    createPresignedUploadMock.mockReset();
    normalizeAdventureImageMimeTypeMock.mockReset();
  });

  it("allocates presigned uploads for authenticated viewers", async () => {
    normalizeAdventureImageMimeTypeMock.mockReturnValue({
      mimeType: "image/jpeg",
      extension: "jpg"
    });
    buildAdventureImageStorageKeyMock.mockReturnValue(
      "adventures/fixture_author_media-1.jpg"
    );
    createPresignedUploadMock.mockResolvedValue({
      method: "PUT",
      url: "https://example.com/upload",
      headers: {
        "Content-Type": "image/jpeg"
      },
      expiresAt: "2026-04-08T18:00:00.000Z"
    });

    const app = await buildMediaRouteApp({
      id: localIdentityFixtures.connected_viewer.seededUser?.id ?? "viewer-123",
      handle: localIdentityFixtures.connected_viewer.seededUser?.handle ?? "fixture_author"
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/media/adventure-uploads",
      payload: {
        items: [
          {
            clientId: "photo-1",
            mimeType: "image/jpeg",
            byteSize: 1234,
            width: 1200,
            height: 900
          }
        ]
      }
    });

    expect(response.statusCode).toBe(200);
    expect(insertPendingMediaAssetsMock).toHaveBeenCalledWith([
      {
        id: expect.any(String),
        ownerUserId: localIdentityFixtures.connected_viewer.seededUser?.id ?? "viewer-123",
        storageKey: "adventures/fixture_author_media-1.jpg",
        kind: "adventure_image",
        mimeType: "image/jpeg",
        byteSize: 1234,
        width: 1200,
        height: 900
      }
    ]);
    expect(response.json()).toEqual({
      items: [
        {
          clientId: "photo-1",
          mediaId: expect.any(String),
          storageKey: "adventures/fixture_author_media-1.jpg",
          upload: {
            method: "PUT",
            url: "https://example.com/upload",
            headers: {
              "Content-Type": "image/jpeg"
            },
            expiresAt: "2026-04-08T18:00:00.000Z"
          }
        }
      ]
    });

    await app.close();
  });

  it("rejects duplicate client ids", async () => {
    const app = await buildMediaRouteApp({
      id: "viewer-123",
      handle: "fixture_author"
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/media/adventure-uploads",
      payload: {
        items: [
          {
            clientId: "photo-1",
            mimeType: "image/jpeg",
            byteSize: 1234
          },
          {
            clientId: "photo-1",
            mimeType: "image/jpeg",
            byteSize: 1235
          }
        ]
      }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      error: "Upload clientIds must be unique."
    });
    expect(insertPendingMediaAssetsMock).not.toHaveBeenCalled();

    await app.close();
  });
});
