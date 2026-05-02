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
  createAdventureComment,
  deleteAdventureFavorite,
  deleteAdventureRating,
  getAdventureById,
  insertAdventureFavorite,
  listAdventureComments,
  listAdventureMedia,
  listFeed,
  upsertAdventureRating
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
          created_at: "2026-03-01 00:00:00+00",
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
          place_label: null,
          distance_miles: null,
          is_favorited: true
        }
      ]
    });

    const result = await listFeed({
      viewerId: undefined,
      limit: 20,
      offset: 0
    });

    expect(result).toEqual({
      items: [
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
          },
          isFavorited: true
        }
      ]
    });
    expect(dbMock.query).toHaveBeenCalledWith(expect.stringContaining("from public.adventures adventures"), [
      null,
      20,
      0,
      null,
      null,
      null
    ]);
    expect(dbMock.query).toHaveBeenCalledWith(
      expect.stringContaining("select $1::uuid as id"),
      [null, 20, 0, null, null, null]
    );
    expect(dbMock.query.mock.calls[0]?.[0]).not.toContain("where handle = $1");
  });

  it("returns stored sidekicks visibility for API cards", async () => {
    dbMock.query.mockResolvedValue({
      rows: [
        {
          id: "adventure-1",
          title: "Quiet Ridge",
          description: null,
          category_slug: "viewpoints",
          visibility: "sidekicks",
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
          place_label: null,
          distance_miles: null,
          is_favorited: false
        }
      ]
    });

    const result = await listFeed({
      viewerId: "viewer-123",
      limit: 20,
      offset: 0
    });

    expect(result.items[0]?.visibility).toBe("sidekicks");
  });

  it("adds scope and distance miles for geo-scoped feed queries", async () => {
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
          latitude: 34.1,
          longitude: -118.4,
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
          place_label: "Topanga",
          distance_miles: 7.4,
          is_favorited: true
        }
      ]
    });

    const result = await listFeed({
      viewerId: "viewer-123",
      limit: 20,
      offset: 0,
      latitude: 34.1201,
      longitude: -118.4512,
      radiusMiles: 25,
      sort: "distance"
    });

    expect(result).toEqual({
      scope: {
        center: {
          latitude: 34.1201,
          longitude: -118.4512
        },
        radiusMiles: 25
      },
      items: [
        expect.objectContaining({
          id: "adventure-1",
          distanceMiles: 7.4,
          isFavorited: true
        })
      ]
    });
    expect(dbMock.query).toHaveBeenCalledWith(
      expect.stringContaining("st_dwithin(adventures.location, scope.center_point, scope.radius_meters)"),
      ["viewer-123", 20, 0, 34.1201, -118.4512, 25]
    );
    expect(dbMock.query.mock.calls[0]?.[0]).toContain("distance_miles asc nulls last");
  });

  it("defaults geo-scoped feed queries without sort to recent ordering", async () => {
    dbMock.query.mockResolvedValue({
      rows: []
    });

    await listFeed({
      viewerId: "viewer-123",
      limit: 20,
      offset: 0,
      latitude: 34.1201,
      longitude: -118.4512,
      radiusMiles: 25
    });

    expect(dbMock.query.mock.calls[0]?.[0]).toContain(
      "coalesce(adventures.published_at, adventures.created_at) desc, adventures.id desc"
    );
    expect(dbMock.query.mock.calls[0]?.[0]).not.toContain("distance_miles asc nulls last");
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
    expect(dbMock.query.mock.calls[0]?.[0]).not.toContain("scope.center_point");
    expect(dbMock.query.mock.calls[0]?.[0]).not.toContain("cross join scope");
  });

  it("maps isFavorited on visible detail lookups", async () => {
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
          viewer_rating: 4,
          place_label: "Topanga",
          updated_at: "2026-03-03T00:00:00.000Z",
          is_favorited: true
        }
      ]
    });

    const result = await getAdventureById({
      adventureId: "4b5edc1d-f292-45b4-8972-7b977ebf5298",
      viewerId: "viewer-123"
    });

    expect(result).toEqual(expect.objectContaining({
      id: "adventure-1",
      isFavorited: true,
      viewerRating: 4,
      updatedAt: "2026-03-03T00:00:00.000Z"
    }));
  });

  it("returns null viewerRating on detail when the viewer has not rated yet", async () => {
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
          favorite_count: 2,
          comment_count: 1,
          rating_count: 12,
          average_rating: 4.5,
          viewer_rating: null,
          place_label: "Topanga",
          updated_at: "2026-03-03T00:00:00.000Z",
          is_favorited: false
        }
      ]
    });

    const result = await getAdventureById({
      adventureId: "4b5edc1d-f292-45b4-8972-7b977ebf5298",
      viewerId: "viewer-123"
    });

    expect(result).toEqual(expect.objectContaining({
      id: "adventure-1",
      viewerRating: null
    }));
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

  it("returns ordered comments for a visible adventure using current profile fields", async () => {
    dbMock.query
      .mockResolvedValueOnce({
        rows: [{ id: "adventure-1" }]
      })
      .mockResolvedValueOnce({
        rows: [
          {
            id: "comment-1",
            body: "Saving this for the weekend.",
            created_at: "2026-03-07 02:00:00-08:00",
            updated_at: "2026-03-07 03:15:00-08:00",
            author_handle: "asanfil",
            author_display_name: "Anthony",
            author_home_city: "Los Angeles",
            author_home_region: "CA"
          }
        ]
      });

    const result = await listAdventureComments({
      adventureId: "4b5edc1d-f292-45b4-8972-7b977ebf5298",
      viewerId: "viewer-123",
      limit: 20,
      offset: 0
    });

    expect(result).toEqual([
      {
        id: "comment-1",
        body: "Saving this for the weekend.",
        createdAt: "2026-03-07T10:00:00.000Z",
        updatedAt: "2026-03-07T11:15:00.000Z",
        author: {
          handle: "asanfil",
          displayName: "Anthony",
          homeCity: "Los Angeles",
          homeRegion: "CA"
        }
      }
    ]);
    expect(dbMock.query).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining("where adventures.id = $2::uuid"),
      ["viewer-123", "4b5edc1d-f292-45b4-8972-7b977ebf5298"]
    );
    expect(dbMock.query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("from public.adventure_comments adventure_comments"),
      ["4b5edc1d-f292-45b4-8972-7b977ebf5298", 20, 0]
    );
  });

  it("returns null for comments when the adventure is not visible", async () => {
    dbMock.query.mockResolvedValueOnce({
      rows: []
    });

    const result = await listAdventureComments({
      adventureId: "4b5edc1d-f292-45b4-8972-7b977ebf5298",
      viewerId: "viewer-123",
      limit: 20,
      offset: 0
    });

    expect(result).toBeNull();
    expect(dbMock.query).toHaveBeenCalledTimes(1);
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

  it("inserts a favorite idempotently and returns the hydrated adventure", async () => {
    dbMock.query
      .mockResolvedValueOnce({
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
            favorite_count: 1,
            comment_count: 0,
            rating_count: 0,
            average_rating: 0,
            place_label: null,
            updated_at: "2026-03-03T00:00:00.000Z",
            is_favorited: false
          }
        ]
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
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
            favorite_count: 1,
            comment_count: 0,
            rating_count: 0,
            average_rating: 0,
            place_label: null,
            updated_at: "2026-03-03T00:00:00.000Z",
            is_favorited: true
          }
        ]
      });

    const result = await insertAdventureFavorite({
      viewerId: "viewer-123",
      adventureId: "4b5edc1d-f292-45b4-8972-7b977ebf5298"
    });

    expect(result).toEqual(expect.objectContaining({
      id: "adventure-1",
      isFavorited: true
    }));
    expect(dbMock.query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("on conflict (user_id, adventure_id) do nothing"),
      ["viewer-123", "4b5edc1d-f292-45b4-8972-7b977ebf5298"]
    );
  });

  it("deletes a favorite idempotently and returns the hydrated adventure", async () => {
    dbMock.query
      .mockResolvedValueOnce({
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
            favorite_count: 1,
            comment_count: 0,
            rating_count: 0,
            average_rating: 0,
            place_label: null,
            updated_at: "2026-03-03T00:00:00.000Z",
            is_favorited: true
          }
        ]
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
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
            favorite_count: 0,
            comment_count: 0,
            rating_count: 0,
            average_rating: 0,
            place_label: null,
            updated_at: "2026-03-03T00:00:00.000Z",
            is_favorited: false
          }
        ]
      });

    const result = await deleteAdventureFavorite({
      viewerId: "viewer-123",
      adventureId: "4b5edc1d-f292-45b4-8972-7b977ebf5298"
    });

    expect(result).toEqual(expect.objectContaining({
      id: "adventure-1",
      isFavorited: false
    }));
    expect(dbMock.query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("delete from public.adventure_favorites"),
      ["viewer-123", "4b5edc1d-f292-45b4-8972-7b977ebf5298"]
    );
  });

  it("creates a comment for a visible adventure and updates comment stats", async () => {
    dbMock.query
      .mockResolvedValueOnce({
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
            favorite_count: 1,
            comment_count: 0,
            rating_count: 0,
            average_rating: 0,
            place_label: null,
            updated_at: "2026-03-03T00:00:00.000Z",
            is_favorited: false
          }
        ]
      })
      .mockResolvedValueOnce({
        rows: [
          {
            id: "comment-1",
            body: "Saving this for the weekend.",
            created_at: "2026-03-07 02:00:00-08:00",
            updated_at: "2026-03-07 03:15:00-08:00",
            author_handle: "asanfil",
            author_display_name: "Anthony",
            author_home_city: "Los Angeles",
            author_home_region: "CA"
          }
        ]
      })
      .mockResolvedValueOnce({ rows: [] });

    const result = await createAdventureComment({
      adventureId: "4b5edc1d-f292-45b4-8972-7b977ebf5298",
      authorUserId: "viewer-123",
      body: "Saving this for the weekend."
    });

    expect(result).toEqual(expect.objectContaining({
      id: "comment-1",
      body: "Saving this for the weekend.",
      createdAt: "2026-03-07T10:00:00.000Z",
      updatedAt: "2026-03-07T11:15:00.000Z",
      author: expect.objectContaining({
        handle: "asanfil"
      })
    }));
    expect(dbMock.query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("insert into public.adventure_comments"),
      expect.arrayContaining([
        "4b5edc1d-f292-45b4-8972-7b977ebf5298",
        "viewer-123",
        "Saving this for the weekend."
      ])
    );
    expect(dbMock.query).toHaveBeenNthCalledWith(
      3,
      expect.stringContaining("comment_count = excluded.comment_count"),
      ["4b5edc1d-f292-45b4-8972-7b977ebf5298"]
    );
  });

  it("preserves imported legacy rating baseline when refreshing stats after a comment", async () => {
    dbMock.query
      .mockResolvedValueOnce({
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
            favorite_count: 1,
            comment_count: 0,
            rating_count: 12,
            average_rating: 4.5,
            place_label: null,
            updated_at: "2026-03-03T00:00:00.000Z",
            is_favorited: false
          }
        ]
      })
      .mockResolvedValueOnce({
        rows: [
          {
            id: "comment-1",
            body: "Still want to try this.",
            created_at: "2026-03-07 02:00:00-08:00",
            updated_at: "2026-03-07 03:15:00-08:00",
            author_handle: "asanfil",
            author_display_name: "Anthony",
            author_home_city: "Los Angeles",
            author_home_region: "CA"
          }
        ]
      })
      .mockResolvedValueOnce({ rows: [] });

    await createAdventureComment({
      adventureId: "4b5edc1d-f292-45b4-8972-7b977ebf5298",
      authorUserId: "viewer-123",
      body: "Still want to try this."
    });

    expect(dbMock.query.mock.calls[2]?.[0]).toContain("legacy_rating_count");
    expect(dbMock.query.mock.calls[2]?.[0]).toContain("legacy_rating_sum");
    expect(dbMock.query.mock.calls[2]?.[0]).toContain(
      "coalesce(existing_stats.legacy_rating_count, 0) + coalesce(ratings.live_rating_count, 0)"
    );
    expect(dbMock.query.mock.calls[2]?.[0]).toContain(
      "coalesce(existing_stats.legacy_rating_sum, 0) + coalesce(ratings.live_rating_sum, 0)"
    );
  });

  it("upserts a viewer rating and returns the hydrated adventure detail", async () => {
    dbMock.query
      .mockResolvedValueOnce({
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
            favorite_count: 1,
            comment_count: 0,
            rating_count: 12,
            average_rating: 4.5,
            viewer_rating: null,
            place_label: null,
            updated_at: "2026-03-03T00:00:00.000Z",
            is_favorited: false
          }
        ]
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
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
            favorite_count: 1,
            comment_count: 0,
            rating_count: 13,
            average_rating: 4.46,
            viewer_rating: 4,
            place_label: null,
            updated_at: "2026-03-03T00:00:00.000Z",
            is_favorited: false
          }
        ]
      })
      .mockResolvedValueOnce({ rows: [] });

    const result = await upsertAdventureRating({
      viewerId: "viewer-123",
      adventureId: "4b5edc1d-f292-45b4-8972-7b977ebf5298",
      score: 4
    });

    expect(result).toEqual(expect.objectContaining({
      id: "adventure-1",
      viewerRating: 4
    }));
    expect(dbMock.query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("insert into public.adventure_ratings"),
      ["viewer-123", "4b5edc1d-f292-45b4-8972-7b977ebf5298", 4]
    );
    expect(dbMock.query.mock.calls[1]?.[0]).toContain("on conflict (user_id, adventure_id) do update set");
    expect(dbMock.query.mock.calls[2]?.[0]).toContain("legacy_rating_count");
  });

  it("deletes a viewer rating idempotently and preserves the legacy baseline", async () => {
    dbMock.query
      .mockResolvedValueOnce({
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
            favorite_count: 1,
            comment_count: 0,
            rating_count: 13,
            average_rating: 4.46,
            viewer_rating: 4,
            place_label: null,
            updated_at: "2026-03-03T00:00:00.000Z",
            is_favorited: false
          }
        ]
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
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
            favorite_count: 1,
            comment_count: 0,
            rating_count: 12,
            average_rating: 4.5,
            viewer_rating: null,
            place_label: null,
            updated_at: "2026-03-03T00:00:00.000Z",
            is_favorited: false
          }
        ]
      })
      .mockResolvedValueOnce({ rows: [] });

    const result = await deleteAdventureRating({
      viewerId: "viewer-123",
      adventureId: "4b5edc1d-f292-45b4-8972-7b977ebf5298"
    });

    expect(result).toEqual(expect.objectContaining({
      id: "adventure-1",
      viewerRating: null
    }));
    expect(dbMock.query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("delete from public.adventure_ratings"),
      ["viewer-123", "4b5edc1d-f292-45b4-8972-7b977ebf5298"]
    );
    expect(dbMock.query.mock.calls[2]?.[0]).toContain("legacy_rating_count");
  });
});
