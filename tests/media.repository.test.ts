import { beforeEach, describe, expect, it, vi } from "vitest";

const { dbMock } = vi.hoisted(() => ({
  dbMock: {
    query: vi.fn()
  }
}));

vi.mock("../src/db/client.js", () => ({
  db: dbMock
}));

import {
  insertPendingMediaAssets,
  listOwnedMediaAssetsForAdventureCreate
} from "../src/features/media/repository.js";

describe("media repository", () => {
  beforeEach(() => {
    dbMock.query.mockReset();
  });

  it("inserts pending media assets with normalized metadata", async () => {
    dbMock.query.mockResolvedValue({ rows: [] });

    await insertPendingMediaAssets([
      {
        id: "media-1",
        ownerUserId: "viewer-123",
        storageKey: "adventures/fixture_author_media-1.jpg",
        kind: "adventure_image",
        mimeType: "image/jpeg",
        byteSize: 1234,
        width: 1200,
        height: 900
      }
    ]);

    expect(dbMock.query).toHaveBeenCalledWith(
      expect.stringContaining("insert into public.media_assets"),
      [
        "media-1",
        "viewer-123",
        "adventures/fixture_author_media-1.jpg",
        "adventure_image",
        "image/jpeg",
        1234,
        1200,
        900
      ]
    );
  });

  it("lists owned unattached media for adventure creation", async () => {
    dbMock.query.mockResolvedValue({
      rows: [
        {
          id: "media-1",
          storage_key: "adventures/fixture_author_media-1.jpg",
          mime_type: "image/jpeg",
          byte_size: 1234,
          width: 1200,
          height: 900,
          already_attached: false
        }
      ]
    });

    const result = await listOwnedMediaAssetsForAdventureCreate({
      ownerUserId: "viewer-123",
      mediaIds: ["media-1"]
    });

    expect(result).toEqual([
      {
        id: "media-1",
        storageKey: "adventures/fixture_author_media-1.jpg",
        mimeType: "image/jpeg",
        byteSize: 1234,
        width: 1200,
        height: 900,
        alreadyAttached: false
      }
    ]);
    expect(dbMock.query).toHaveBeenCalledWith(
      expect.stringContaining("media_assets.owner_user_id = $1::uuid"),
      ["viewer-123", ["media-1"]]
    );
  });
});
