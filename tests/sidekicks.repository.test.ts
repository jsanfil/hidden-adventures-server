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
  addSidekickGrant,
  listDiscoveredProfiles,
  listMySidekicks,
  removeSidekickGrant,
  searchProfiles
} from "../src/features/sidekicks/repository.js";

describe("sidekicks repository", () => {
  beforeEach(() => {
    dbMock.query.mockReset();
  });

  it("lists outbound sidekicks with profile-style payloads", async () => {
    dbMock.query.mockResolvedValue({
      rows: [
        {
          profile_id: "user-2",
          handle: "maya",
          display_name: "Maya",
          bio: "Explorer",
          home_city: "Los Angeles",
          home_region: "CA",
          avatar_media_id: "avatar-1",
          avatar_storage_key: "profiles/maya.jpg",
          is_sidekick: true,
          adventures_count: "4"
        }
      ]
    });

    const result = await listMySidekicks({
      viewerId: "viewer-1",
      limit: 20,
      offset: 0
    });

    expect(result).toEqual([
      {
        profile: {
          id: "user-2",
          handle: "maya",
          displayName: "Maya",
          bio: "Explorer",
          homeCity: "Los Angeles",
          homeRegion: "CA",
          avatar: {
            id: "avatar-1",
            storageKey: "profiles/maya.jpg"
          }
        },
        relationship: {
          isSidekick: true
        },
        stats: {
          adventuresCount: 4
        }
      }
    ]);
    expect(dbMock.query.mock.calls[0]?.[0]).toContain("order by max(granted.created_at) desc");
  });

  it("discovers profiles and annotates existing sidekick state", async () => {
    dbMock.query.mockResolvedValue({
      rows: [
        {
          profile_id: "user-3",
          handle: "ivy",
          display_name: "Ivy",
          bio: null,
          home_city: "Santa Monica",
          home_region: "CA",
          avatar_media_id: null,
          avatar_storage_key: null,
          is_sidekick: false,
          adventures_count: "2"
        }
      ]
    });

    const result = await listDiscoveredProfiles({
      viewerId: "viewer-1",
      limit: 10,
      offset: 0
    });

    expect(result[0]?.relationship.isSidekick).toBe(false);
    expect(dbMock.query.mock.calls[0]?.[0]).toContain("order by users.created_at desc");
  });

  it("searches across handle, name, city, and region", async () => {
    dbMock.query.mockResolvedValue({ rows: [] });

    await searchProfiles({
      viewerId: "viewer-1",
      query: "Port",
      limit: 5,
      offset: 0
    });

    expect(dbMock.query.mock.calls[0]?.[0]).toContain("profiles.home_city");
    expect(dbMock.query.mock.calls[0]?.[0]).toContain("profiles.home_region");
    expect(dbMock.query.mock.calls[0]?.[1]).toEqual(["viewer-1", 5, 0, "%Port%", "Port", "Port%"]);
  });

  it("adds and removes sidekick grants idempotently via the summary lookup path", async () => {
    dbMock.query
      .mockResolvedValueOnce({ rows: [{ user_id: "user-2", handle: "maya" }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          {
            profile_id: "user-2",
            handle: "maya",
            display_name: "Maya",
            bio: null,
            home_city: null,
            home_region: null,
            avatar_media_id: null,
            avatar_storage_key: null,
            is_sidekick: true,
            adventures_count: "0"
          }
        ]
      })
      .mockResolvedValueOnce({ rows: [{ user_id: "user-2", handle: "maya" }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          {
            profile_id: "user-2",
            handle: "maya",
            display_name: "Maya",
            bio: null,
            home_city: null,
            home_region: null,
            avatar_media_id: null,
            avatar_storage_key: null,
            is_sidekick: false,
            adventures_count: "0"
          }
        ]
      });

    const added = await addSidekickGrant({
      viewerId: "viewer-1",
      handle: "maya"
    });
    const removed = await removeSidekickGrant({
      viewerId: "viewer-1",
      handle: "maya"
    });

    expect(added?.relationship.isSidekick).toBe(true);
    expect(removed?.relationship.isSidekick).toBe(false);
  });
});
