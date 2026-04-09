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
  createAdventure,
  getAdventureById,
  getMediaDeliveryTarget,
  listAdventureMedia,
  listFeed
} from "../src/features/adventures/repository.js";

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
          description: null,
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
          average_rating: null,
          place_label: null
        }
      ]
    });

    const result = await listFeed({
      viewerId: undefined,
      limit: 20,
      offset: 0
    });

    expect(result).toEqual([
      {
        id: "adventure-1",
        title: "Quiet Ridge",
        description: null,
        categorySlug: "viewpoints",
        visibility: "public",
        createdAt: "2026-03-01T00:00:00.000Z",
        publishedAt: null,
        location: null,
        placeLabel: null,
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
    expect(dbMock.query).toHaveBeenCalledWith(
      expect.stringContaining("select $1::uuid as id"),
      [null, 20, 0]
    );
    expect(dbMock.query.mock.calls[0]?.[0]).not.toContain("where handle = $1");
  });

  it("returns null when a detail lookup finds no visible adventure", async () => {
    dbMock.query.mockResolvedValue({
      rows: []
    });

    const result = await getAdventureById({
      adventureId: "4b5edc1d-f292-45b4-8972-7b977ebf5298"
    });

    expect(result).toBeNull();
    expect(dbMock.query).toHaveBeenCalledWith(
      expect.stringContaining("select $1::uuid as id"),
      [null, "4b5edc1d-f292-45b4-8972-7b977ebf5298"]
    );
  });

  it("returns ordered adventure media for a visible detail carousel", async () => {
    dbMock.query
      .mockResolvedValueOnce({
        rows: [{ id: "adventure-1" }]
      })
      .mockResolvedValueOnce({
        rows: [
          {
            media_id: "media-1",
            sort_order: 0,
            is_primary: true,
            width: 1200,
            height: 900
          },
          {
            media_id: "media-2",
            sort_order: 1,
            is_primary: false,
            width: 1024,
            height: 768
          }
        ]
      });

    const result = await listAdventureMedia({
      adventureId: "4b5edc1d-f292-45b4-8972-7b977ebf5298",
      viewerId: "viewer-123"
    });

    expect(result).toEqual([
      {
        id: "media-1",
        sortOrder: 0,
        isPrimary: true,
        width: 1200,
        height: 900
      },
      {
        id: "media-2",
        sortOrder: 1,
        isPrimary: false,
        width: 1024,
        height: 768
      }
    ]);
    expect(dbMock.query).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining("where adventures.id = $2::uuid"),
      ["viewer-123", "4b5edc1d-f292-45b4-8972-7b977ebf5298"]
    );
    expect(dbMock.query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("from public.adventure_media adventure_media"),
      ["4b5edc1d-f292-45b4-8972-7b977ebf5298"]
    );
  });

  it("returns null when media delivery target is not visible", async () => {
    dbMock.query.mockResolvedValue({
      rows: []
    });

    const result = await getMediaDeliveryTarget({
      mediaId: "f2f81540-45c1-4a0d-a080-9df1b8b020c2",
      viewerId: "viewer-123"
    });

    expect(result).toBeNull();
    expect(dbMock.query).toHaveBeenCalledWith(
      expect.stringContaining("where media_assets.id = $2::uuid"),
      ["viewer-123", "f2f81540-45c1-4a0d-a080-9df1b8b020c2"]
    );
  });

  it("creates an adventure and ordered media rows in one transaction", async () => {
    const client = {
      query: vi.fn()
    };

    client.query
      .mockResolvedValueOnce({
        rows: [
          {
            id: "adventure-1",
            status: "pending_moderation"
          }
        ]
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const result = await createAdventure(
      {
        authorUserId: "viewer-123",
        title: "Hidden Falls",
        description: "Bring water and wear good shoes.",
        categorySlug: "water_spots",
        visibility: "public",
        location: {
          latitude: 34.12,
          longitude: -118.45
        },
        placeLabel: "Hidden Falls Trailhead",
        media: [
          {
            mediaId: "media-1",
            sortOrder: 0,
            isPrimary: true
          },
          {
            mediaId: "media-2",
            sortOrder: 1,
            isPrimary: false
          }
        ],
        status: "pending_moderation"
      },
      client as never
    );

    expect(result).toEqual({
      id: "adventure-1",
      status: "pending_moderation"
    });
    expect(client.query).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining("insert into public.adventures"),
      expect.arrayContaining([
        "viewer-123",
        "Hidden Falls",
        "Bring water and wear good shoes.",
        "water_spots",
        "public",
        "pending_moderation",
        -118.45,
        34.12,
        "Hidden Falls Trailhead"
      ])
    );
    expect(client.query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("insert into public.adventure_media"),
      [expect.any(String), "media-1", 0, true]
    );
    expect(client.query).toHaveBeenNthCalledWith(
      3,
      expect.stringContaining("insert into public.adventure_media"),
      [expect.any(String), "media-2", 1, false]
    );
  });
});
