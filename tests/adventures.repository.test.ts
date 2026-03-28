import { beforeEach, describe, expect, it, vi } from "vitest";

const { dbMock } = vi.hoisted(() => ({
  dbMock: {
    query: vi.fn()
  }
}));

vi.mock("../src/db/client.js", () => ({
  db: dbMock
}));

import { getAdventureById, listFeed } from "../src/features/adventures/repository.js";

describe("adventures repository", () => {
  beforeEach(() => {
    dbMock.query.mockReset();
  });

  it("maps feed rows into API cards and defaults missing stats to zero", async () => {
    dbMock.query.mockResolvedValue({
      rows: [
        {
          id: "adventure-1",
          title: "Quiet Ridge",
          summary: null,
          body: null,
          category_slug: "viewpoints",
          visibility: "public",
          created_at: "2026-03-01T00:00:00.000Z",
          published_at: null,
          latitude: null,
          longitude: null,
          author_handle: "jacksanfil",
          author_display_name: null,
          author_home_city: null,
          author_home_region: null,
          primary_media_id: null,
          primary_media_storage_key: null,
          favorite_count: null,
          comment_count: null,
          rating_count: null,
          average_rating: null
        }
      ]
    });

    const result = await listFeed({
      viewerHandle: undefined,
      limit: 20,
      offset: 0
    });

    expect(result).toEqual([
      {
        id: "adventure-1",
        title: "Quiet Ridge",
        summary: null,
        body: null,
        categorySlug: "viewpoints",
        visibility: "public",
        createdAt: "2026-03-01T00:00:00.000Z",
        publishedAt: null,
        location: null,
        author: {
          handle: "jacksanfil",
          displayName: null,
          homeCity: null,
          homeRegion: null
        },
        primaryMedia: null,
        stats: {
          favoriteCount: 0,
          commentCount: 0,
          ratingCount: 0,
          averageRating: 0
        }
      }
    ]);
    expect(dbMock.query).toHaveBeenCalledWith(expect.stringContaining("from public.adventures adventures"), [
      null,
      20,
      0
    ]);
  });

  it("returns null when a detail lookup finds no visible adventure", async () => {
    dbMock.query.mockResolvedValue({
      rows: []
    });

    const result = await getAdventureById({
      adventureId: "4b5edc1d-f292-45b4-8972-7b977ebf5298"
    });

    expect(result).toBeNull();
  });
});
