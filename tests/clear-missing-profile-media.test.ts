import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

const { dbMock } = vi.hoisted(() => ({
  dbMock: {
    query: vi.fn(),
    close: vi.fn()
  }
}));

vi.mock("../src/db/client.js", () => ({
  db: dbMock
}));

import {
  loadMissingProfileMediaEntries,
  parseArgs,
  runClearMissingProfileMedia
} from "../src/scripts/clear-missing-profile-media.js";

describe("clear missing profile media script", () => {
  beforeEach(() => {
    dbMock.query.mockReset();
    dbMock.close.mockReset();
  });

  it("parses CLI args with dry-run defaults", () => {
    expect(parseArgs(["--report", "/tmp/report.json"])).toEqual({
      apply: false,
      reportPath: "/tmp/report.json"
    });

    expect(parseArgs(["--report", "/tmp/report.json", "--apply"])).toEqual({
      apply: true,
      reportPath: "/tmp/report.json"
    });
  });

  it("loads only missing profile avatar and cover entries from the namespace report", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "ha-clear-profile-media-"));
    const reportPath = path.join(tempDir, "report.json");

    await writeFile(
      reportPath,
      JSON.stringify(
        {
          entries: [
            {
              mediaAssetId: "media-avatar",
              kind: "profile_avatar",
              oldKey: "avatar.jpg",
              newKey: "profile-avatars/avatar.jpg",
              status: "missing_source"
            },
            {
              mediaAssetId: "media-cover",
              kind: "profile_cover",
              oldKey: "cover.jpg",
              newKey: "profile-covers/cover.jpg",
              status: "missing_source"
            },
            {
              mediaAssetId: "media-adventure",
              kind: "adventure_image",
              oldKey: "adventure.jpg",
              newKey: "adventures/adventure.jpg",
              status: "missing_source"
            },
            {
              mediaAssetId: "planned-avatar",
              kind: "profile_avatar",
              oldKey: "planned.jpg",
              newKey: "profile-avatars/planned.jpg",
              status: "planned"
            }
          ]
        },
        null,
        2
      ),
      "utf8"
    );

    const entries = await loadMissingProfileMediaEntries(reportPath);

    expect(entries).toEqual([
      {
        mediaAssetId: "media-avatar",
        kind: "profile_avatar",
        oldKey: "avatar.jpg",
        profileColumn: "avatar_media_asset_id"
      },
      {
        mediaAssetId: "media-cover",
        kind: "profile_cover",
        oldKey: "cover.jpg",
        profileColumn: "cover_media_asset_id"
      }
    ]);

    await rm(tempDir, { recursive: true, force: true });
  });

  it("dry run reports the resolved profile user and column without mutating timestamps", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "ha-clear-profile-media-"));
    const reportPath = path.join(tempDir, "report.json");

    await writeFile(
      reportPath,
      JSON.stringify(
        {
          entries: [
            {
              mediaAssetId: "media-avatar",
              kind: "profile_avatar",
              oldKey: "avatar.jpg",
              newKey: "profile-avatars/avatar.jpg",
              status: "missing_source"
            }
          ]
        },
        null,
        2
      ),
      "utf8"
    );

    dbMock.query.mockResolvedValueOnce({
      rows: [{ user_id: "user-1", media_deleted_at: null }]
    });

    const report = await runClearMissingProfileMedia({
      apply: false,
      reportPath
    });

    expect(report.examined).toBe(1);
    expect(report.eligible).toBe(1);
    expect(report.entries[0]).toEqual({
      mediaAssetId: "media-avatar",
      kind: "profile_avatar",
      oldKey: "avatar.jpg",
      profileUserId: "user-1",
      profileColumn: "avatar_media_asset_id",
      status: "planned"
    });
    expect(dbMock.query).toHaveBeenCalledTimes(1);

    const written = JSON.parse(await readFile(reportPath, "utf8")) as {
      cleanup: { entries: Array<{ status: string }> };
    };
    expect(written.cleanup.entries[0]?.status).toBe("planned");

    await rm(tempDir, { recursive: true, force: true });
  });

  it("apply clears the matching profile reference and soft-deletes the linked media asset", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "ha-clear-profile-media-"));
    const reportPath = path.join(tempDir, "report.json");

    await writeFile(
      reportPath,
      JSON.stringify(
        {
          entries: [
            {
              mediaAssetId: "media-cover",
              kind: "profile_cover",
              oldKey: "cover.jpg",
              newKey: "profile-covers/cover.jpg",
              status: "missing_source"
            }
          ]
        },
        null,
        2
      ),
      "utf8"
    );

    dbMock.query
      .mockResolvedValueOnce({
        rows: [{ user_id: "user-2", media_deleted_at: null }]
      })
      .mockResolvedValueOnce({ rowCount: 1, rows: [] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [] });

    const report = await runClearMissingProfileMedia({
      apply: true,
      reportPath
    });

    expect(dbMock.query.mock.calls[1]?.[0]).toContain("set cover_media_asset_id = null");
    expect(dbMock.query.mock.calls[1]?.[0]).not.toContain("updated_at");
    expect(dbMock.query.mock.calls[1]?.[0]).not.toContain("created_at");
    expect(dbMock.query.mock.calls[2]?.[0]).toContain("set deleted_at = coalesce(deleted_at, now())");
    expect(dbMock.query.mock.calls[2]?.[0]).not.toContain("updated_at");
    expect(dbMock.query.mock.calls[2]?.[0]).not.toContain("created_at");
    expect(report.clearedProfiles).toBe(1);
    expect(report.softDeletedAssets).toBe(1);
    expect(report.entries[0]?.status).toBe("cleared");

    await rm(tempDir, { recursive: true, force: true });
  });

  it("skips entries when no matching profile reference remains", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "ha-clear-profile-media-"));
    const reportPath = path.join(tempDir, "report.json");

    await writeFile(
      reportPath,
      JSON.stringify(
        {
          entries: [
            {
              mediaAssetId: "media-avatar",
              kind: "profile_avatar",
              oldKey: "avatar.jpg",
              newKey: "profile-avatars/avatar.jpg",
              status: "missing_source"
            }
          ]
        },
        null,
        2
      ),
      "utf8"
    );

    dbMock.query.mockResolvedValueOnce({ rows: [] });

    const report = await runClearMissingProfileMedia({
      apply: true,
      reportPath
    });

    expect(report.skipped).toBe(1);
    expect(report.entries[0]?.status).toBe("skipped");
    expect(dbMock.query).toHaveBeenCalledTimes(1);

    await rm(tempDir, { recursive: true, force: true });
  });

  it("reports already-soft-deleted assets while still clearing the profile reference", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "ha-clear-profile-media-"));
    const reportPath = path.join(tempDir, "report.json");

    await writeFile(
      reportPath,
      JSON.stringify(
        {
          entries: [
            {
              mediaAssetId: "media-avatar",
              kind: "profile_avatar",
              oldKey: "avatar.jpg",
              newKey: "profile-avatars/avatar.jpg",
              status: "missing_source"
            }
          ]
        },
        null,
        2
      ),
      "utf8"
    );

    dbMock.query
      .mockResolvedValueOnce({
        rows: [{ user_id: "user-3", media_deleted_at: "2026-04-01T00:00:00.000Z" }]
      })
      .mockResolvedValueOnce({ rowCount: 1, rows: [] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [] });

    const report = await runClearMissingProfileMedia({
      apply: true,
      reportPath
    });

    expect(report.clearedProfiles).toBe(1);
    expect(report.softDeletedAssets).toBe(0);
    expect(report.entries[0]?.status).toBe("already_deleted");

    await rm(tempDir, { recursive: true, force: true });
  });
});
