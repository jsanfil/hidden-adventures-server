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
  listDiscoverHome,
  searchDiscover
} from "../src/features/discover/repository.js";

describe("discover repository", () => {
  beforeEach(() => {
    dbMock.query.mockReset();
  });

  it("returns discover home modules with ordered adventurers and adventure cards", async () => {
    dbMock.query
      .mockResolvedValueOnce({
        rows: [
          {
            id: "user-1",
            handle: "mayaexplores",
            display_name: "Maya Reyes",
            home_city: "Portland",
            home_region: "OR",
            avatar_media_id: "avatar-1",
            avatar_storage_key: "profiles/maya.jpg",
            preview_media_id: "media-10",
            preview_media_storage_key: "adventures/maya-preview.jpg",
            public_adventure_count: "62",
            top_category_slugs: ["water_spots", "caves"]
          }
        ]
      })
      .mockResolvedValueOnce({
        rows: [
          {
            id: "adventure-1",
            title: "Eagle Creek Trail to Tunnel Falls",
            description: "Bring water and wear good shoes.",
            category_slug: "water_spots",
            visibility: "public",
            created_at: "2026-03-01 00:00:00+00",
            published_at: "2026-03-02 00:00:00+00",
            latitude: 45.64,
            longitude: -121.91,
            author_handle: "mayaexplores",
            author_display_name: "Maya Reyes",
            author_home_city: "Portland",
            author_home_region: "OR",
            primary_media_id: "media-10",
            primary_media_storage_key: "adventures/maya-preview.jpg",
            favorite_count: 3104,
            comment_count: 118,
            rating_count: 847,
            average_rating: 4.9,
            place_label: "Columbia River Gorge, OR",
            distance_miles: null,
            is_favorited: true
          }
        ]
      });

    const result = await listDiscoverHome("viewer-1");

    expect(result).toEqual({
      modules: [
        {
          id: "explore-adventurers",
          type: "adventurers",
          title: "Explore Adventurers",
          items: [
            {
              id: "user-1",
              handle: "mayaexplores",
              displayName: "Maya Reyes",
              homeCity: "Portland",
              homeRegion: "OR",
              avatar: {
                id: "avatar-1",
                storageKey: "profiles/maya.jpg"
              },
              previewMedia: {
                id: "media-10",
                storageKey: "adventures/maya-preview.jpg"
              },
              publicAdventureCount: 62,
              topCategorySlugs: ["water_spots", "caves"]
            }
          ]
        },
        {
          id: "popular-adventures",
          type: "adventures",
          title: "Popular Adventures",
          items: [
            {
              id: "adventure-1",
              title: "Eagle Creek Trail to Tunnel Falls",
              description: "Bring water and wear good shoes.",
              categorySlug: "water_spots",
              visibility: "public",
              createdAt: "2026-03-01T00:00:00.000Z",
              publishedAt: "2026-03-02T00:00:00.000Z",
              location: {
                latitude: 45.64,
                longitude: -121.91
              },
              placeLabel: "Columbia River Gorge, OR",
              author: {
                handle: "mayaexplores",
                displayName: "Maya Reyes",
                homeCity: "Portland",
                homeRegion: "OR"
              },
              primaryMedia: {
                id: "media-10",
                storageKey: "adventures/maya-preview.jpg"
              },
              stats: {
                favoriteCount: 3104,
                commentCount: 118,
                ratingCount: 847,
                averageRating: 4.9
              },
              isFavorited: true
            }
          ]
        }
      ]
    });
    expect(dbMock.query.mock.calls[0]?.[0]).toContain("public_adventure_count");
    expect(dbMock.query.mock.calls[0]?.[0]).toContain("top_category_slugs");
    expect(dbMock.query.mock.calls[1]?.[0]).toContain("adventure_stats.favorite_count desc");
  });

  it("builds discover home top categories from distinct category counts", async () => {
    dbMock.query
      .mockResolvedValueOnce({
        rows: []
      })
      .mockResolvedValueOnce({
        rows: []
      });

    await listDiscoverHome("viewer-1");

    expect(dbMock.query.mock.calls[0]?.[0]).toContain("array_agg(top_categories.category_slug order by");
    expect(dbMock.query.mock.calls[0]?.[0]).toContain("group by category_slug");
    expect(dbMock.query.mock.calls[0]?.[0]).not.toContain("array_agg(adventures.category_slug order by");
  });

  it("searches grouped people and adventures with independent paging and query echo", async () => {
    dbMock.query
      .mockResolvedValueOnce({
        rows: [
          {
            id: "user-1",
            handle: "mayaexplores",
            display_name: "Maya Reyes",
            home_city: "Portland",
            home_region: "OR",
            avatar_media_id: null,
            avatar_storage_key: null,
            preview_media_id: null,
            preview_media_storage_key: null,
            public_adventure_count: "62",
            top_category_slugs: ["water_spots", "caves"]
          }
        ]
      })
      .mockResolvedValueOnce({
        rows: [
          {
            id: "adventure-1",
            title: "Eagle Creek Trail to Tunnel Falls",
            description: null,
            category_slug: "water_spots",
            visibility: "public",
            created_at: "2026-03-01T00:00:00.000Z",
            published_at: "2026-03-02T00:00:00.000Z",
            latitude: null,
            longitude: null,
            author_handle: "mayaexplores",
            author_display_name: "Maya Reyes",
            author_home_city: "Portland",
            author_home_region: "OR",
            primary_media_id: null,
            primary_media_storage_key: null,
            favorite_count: 3104,
            comment_count: 118,
            rating_count: 847,
            average_rating: 4.9,
            place_label: "Columbia River Gorge, OR",
            distance_miles: null,
            is_favorited: false
          }
        ]
      });

    const result = await searchDiscover({
      viewerId: "viewer-1",
      query: "Maya",
      limit: 5,
      offset: 10
    });

    expect(result).toEqual({
      query: "Maya",
      people: {
        items: [
          expect.objectContaining({
            handle: "mayaexplores",
            publicAdventureCount: 62
          })
        ]
      },
      adventures: {
        items: [
          expect.objectContaining({
            id: "adventure-1",
            title: "Eagle Creek Trail to Tunnel Falls",
            isFavorited: false
          })
        ]
      }
    });
    expect(dbMock.query.mock.calls[0]?.[1]).toEqual([5, 10, "%Maya%", "Maya", "Maya%"]);
    expect(dbMock.query.mock.calls[1]?.[1]).toEqual([5, 10, "%Maya%", "Maya", "Maya%", "viewer-1"]);
    expect(dbMock.query.mock.calls[0]?.[0]).toContain("users.handle ilike $3");
    expect(dbMock.query.mock.calls[1]?.[0]).toContain("adventures.place_label");
  });

  it("builds discover search top categories from distinct category counts", async () => {
    dbMock.query
      .mockResolvedValueOnce({
        rows: []
      })
      .mockResolvedValueOnce({
        rows: []
      });

    await searchDiscover({
      viewerId: "viewer-1",
      query: "Maya",
      limit: 5,
      offset: 0
    });

    expect(dbMock.query.mock.calls[0]?.[0]).toContain("array_agg(top_categories.category_slug order by");
    expect(dbMock.query.mock.calls[0]?.[0]).toContain("group by category_slug");
    expect(dbMock.query.mock.calls[0]?.[0]).not.toContain("array_agg(adventures.category_slug order by");
  });
});
