import { beforeEach, describe, expect, it, vi } from "vitest";

const { dbMock, s3SendMock } = vi.hoisted(() => ({
  dbMock: {
    query: vi.fn(),
    close: vi.fn()
  },
  s3SendMock: vi.fn()
}));

vi.mock("../src/db/client.js", () => ({
  db: dbMock
}));

vi.mock("@aws-sdk/client-s3", async () => {
  const actual = await vi.importActual<typeof import("@aws-sdk/client-s3")>("@aws-sdk/client-s3");

  class MockS3Client {
    send = s3SendMock;
  }

  return {
    ...actual,
    S3Client: MockS3Client
  };
});

import {
  applyMigrations,
  buildNamespacedKey,
  isAlreadyNamespaced,
  parseArgs,
  planNamespaceMigration,
  preflightMigrations,
  runNamespaceMediaAssets,
  type NamespaceReport
} from "../src/scripts/namespace-media-assets.js";
import {
  CopyObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  S3Client
} from "@aws-sdk/client-s3";
import { readFile, unlink } from "node:fs/promises";

describe("namespace media assets script", () => {
  beforeEach(() => {
    dbMock.query.mockReset();
    dbMock.close.mockReset();
    s3SendMock.mockReset();
  });

  it("maps supported kinds to the expected namespace prefixes", () => {
    expect(buildNamespacedKey("adventure_image", "legacy/image.jpg")).toBe("adventures/image.jpg");
    expect(buildNamespacedKey("profile_avatar", "avatar.png")).toBe("profile-avatars/avatar.png");
    expect(buildNamespacedKey("profile_cover", "nested/cover.webp")).toBe("profile-covers/cover.webp");
  });

  it("detects already namespaced keys", () => {
    expect(isAlreadyNamespaced("adventure_image", "adventures/image.jpg")).toBe(true);
    expect(isAlreadyNamespaced("profile_avatar", "flat/avatar.png")).toBe(false);
  });

  it("parses CLI args with dry-run defaults", () => {
    expect(parseArgs([])).toEqual({
      apply: false,
      bucket: "hidden-adventures-nonprod",
      reportPath: undefined
    });

    expect(parseArgs(["--apply", "--report", "/tmp/report.json", "--bucket", "other-bucket"])).toEqual({
      apply: true,
      bucket: "other-bucket",
      reportPath: "/tmp/report.json"
    });
  });

  it("classifies eligible, already migrated, and duplicate target collisions", () => {
    const { report, plannedMigrations } = planNamespaceMigration(
      [
        {
          id: "media-1",
          kind: "adventure_image",
          storage_key: "legacy/a.jpg"
        },
        {
          id: "media-2",
          kind: "profile_avatar",
          storage_key: "profile-avatars/avatar.jpg"
        },
        {
          id: "media-3",
          kind: "adventure_image",
          storage_key: "other/a.jpg"
        },
        {
          id: "media-4",
          kind: "unknown",
          storage_key: "ignored.jpg"
        }
      ],
      {
        apply: false,
        bucket: "hidden-adventures-nonprod"
      }
    );

    expect(plannedMigrations).toEqual([
      {
        mediaAssetId: "media-1",
        kind: "adventure_image",
        oldKey: "legacy/a.jpg",
        newKey: "adventures/a.jpg"
      }
    ]);
    expect(report.examined).toBe(4);
    expect(report.eligible).toBe(1);
    expect(report.alreadyNamespaced).toBe(1);
    expect(report.collisions).toBe(1);
    expect(report.skipped).toBe(1);
    expect(report.entries.map((entry) => entry.status)).toEqual([
      "planned",
      "already_namespaced",
      "collision",
      "skipped"
    ]);
  });

  it("marks missing source objects during preflight", async () => {
    const client = new S3Client({ region: "us-west-2" });
    const { report, plannedMigrations } = planNamespaceMigration(
      [
        {
          id: "media-1",
          kind: "adventure_image",
          storage_key: "legacy/a.jpg"
        }
      ],
      {
        apply: false,
        bucket: "hidden-adventures-nonprod"
      }
    );

    s3SendMock.mockImplementation(async (command: unknown) => {
      if (command instanceof HeadObjectCommand) {
        throw Object.assign(new Error("Not found"), { name: "NotFound" });
      }

      return {};
    });

    await expect(
      preflightMigrations(client, plannedMigrations, report, "hidden-adventures-nonprod")
    ).rejects.toThrow("Preflight failed");

    expect(report.missingSources).toBe(1);
    expect(report.entries[0]?.status).toBe("missing_source");
  });

  it("aborts preflight when the target key already exists", async () => {
    const client = new S3Client({ region: "us-west-2" });
    const { report, plannedMigrations } = planNamespaceMigration(
      [
        {
          id: "media-1",
          kind: "adventure_image",
          storage_key: "legacy/a.jpg"
        }
      ],
      {
        apply: false,
        bucket: "hidden-adventures-nonprod"
      }
    );

    s3SendMock.mockImplementation(async (command: unknown) => {
      if (command instanceof HeadObjectCommand) {
        const input = command.input as { Key?: string };
        if (input.Key === "legacy/a.jpg") {
          return {};
        }

        return {};
      }

      return {};
    });

    await expect(
      preflightMigrations(client, plannedMigrations, report, "hidden-adventures-nonprod")
    ).rejects.toThrow("Preflight failed");

    expect(report.collisions).toBe(1);
    expect(report.entries[0]?.status).toBe("collision");
  });

  it("copies, updates the DB key, and deletes the old object during apply", async () => {
    const client = new S3Client({ region: "us-west-2" });
    const { report, plannedMigrations } = planNamespaceMigration(
      [
        {
          id: "media-1",
          kind: "adventure_image",
          storage_key: "legacy/a.jpg"
        }
      ],
      {
        apply: true,
        bucket: "hidden-adventures-nonprod"
      }
    );

    s3SendMock.mockImplementation(async (command: unknown) => {
      if (command instanceof HeadObjectCommand) {
        const input = command.input as { Key?: string };
        if (input.Key === "legacy/a.jpg") {
          return {};
        }

        throw Object.assign(new Error("Not found"), { name: "NotFound" });
      }

      return {};
    });
    dbMock.query.mockResolvedValue({ rowCount: 1, rows: [] });

    await applyMigrations(client, plannedMigrations, report, "hidden-adventures-nonprod");

    expect(s3SendMock.mock.calls[0]?.[0]).toBeInstanceOf(HeadObjectCommand);
    expect(s3SendMock.mock.calls[1]?.[0]).toBeInstanceOf(HeadObjectCommand);
    expect(s3SendMock.mock.calls[2]?.[0]).toBeInstanceOf(CopyObjectCommand);
    expect(dbMock.query).toHaveBeenCalledWith(
      expect.stringContaining("update public.media_assets"),
      ["adventures/a.jpg", "media-1", "legacy/a.jpg"]
    );
    expect(dbMock.query.mock.calls[0]?.[0]).not.toContain("updated_at");
    expect(dbMock.query.mock.calls[0]?.[0]).not.toContain("created_at");
    expect(s3SendMock.mock.calls[3]?.[0]).toBeInstanceOf(DeleteObjectCommand);
    expect(report.migrated).toBe(1);
    expect(report.entries[0]?.status).toBe("migrated");
  });

  it("does not delete the old object when the DB update affects zero rows", async () => {
    const client = new S3Client({ region: "us-west-2" });
    const { report, plannedMigrations } = planNamespaceMigration(
      [
        {
          id: "media-1",
          kind: "adventure_image",
          storage_key: "legacy/a.jpg"
        }
      ],
      {
        apply: true,
        bucket: "hidden-adventures-nonprod"
      }
    );

    s3SendMock.mockImplementation(async (command: unknown) => {
      if (command instanceof HeadObjectCommand) {
        const input = command.input as { Key?: string };
        if (input.Key === "legacy/a.jpg") {
          return {};
        }

        throw Object.assign(new Error("Not found"), { name: "NotFound" });
      }

      return {};
    });
    dbMock.query.mockResolvedValue({ rowCount: 0, rows: [] });

    await expect(
      applyMigrations(client, plannedMigrations, report, "hidden-adventures-nonprod")
    ).rejects.toThrow("Expected exactly one media_assets row to update");

    expect(s3SendMock).toHaveBeenCalledTimes(3);
    expect(s3SendMock.mock.calls.some((call) => call[0] instanceof DeleteObjectCommand)).toBe(false);
  });

  it("aborts apply before copy when the target key already exists", async () => {
    const client = new S3Client({ region: "us-west-2" });
    const { report, plannedMigrations } = planNamespaceMigration(
      [
        {
          id: "media-1",
          kind: "adventure_image",
          storage_key: "legacy/a.jpg"
        }
      ],
      {
        apply: true,
        bucket: "hidden-adventures-nonprod"
      }
    );

    s3SendMock.mockImplementation(async (command: unknown) => {
      if (command instanceof HeadObjectCommand) {
        const input = command.input as { Key?: string };
        if (input.Key === "legacy/a.jpg") {
          return {};
        }

        return {};
      }

      return {};
    });

    await expect(
      applyMigrations(client, plannedMigrations, report, "hidden-adventures-nonprod")
    ).rejects.toThrow('Target object "adventures/a.jpg" already exists in S3.');

    expect(s3SendMock.mock.calls.some((call) => call[0] instanceof CopyObjectCommand)).toBe(false);
    expect(dbMock.query).not.toHaveBeenCalled();
  });

  it("runs the full dry-run flow and returns the final report", async () => {
    dbMock.query.mockResolvedValueOnce({
      rows: [
        {
          id: "media-1",
          kind: "adventure_image",
          storage_key: "legacy/a.jpg"
        },
        {
          id: "media-2",
          kind: "profile_avatar",
          storage_key: "profile-avatars/already.jpg"
        }
      ]
    });

    s3SendMock.mockImplementation(async (command: unknown) => {
      if (command instanceof HeadObjectCommand) {
        const input = command.input as { Key?: string };
        if (input.Key === "legacy/a.jpg") {
          return {};
        }

        throw Object.assign(new Error("Not found"), { name: "NotFound" });
      }

      return {};
    });

    const report = await runNamespaceMediaAssets({
      apply: false,
      bucket: "hidden-adventures-nonprod"
    });

    expect((report as NamespaceReport).examined).toBe(2);
    expect(report.alreadyNamespaced).toBe(1);
    expect(report.planned).toBe(1);
    expect(report.migrated).toBe(0);
  });

  it("writes the report file even when preflight fails", async () => {
    const reportPath = "/tmp/namespace-media-assets-preflight-failure.json";

    dbMock.query.mockResolvedValueOnce({
      rows: [
        {
          id: "media-1",
          kind: "adventure_image",
          storage_key: "legacy/a.jpg"
        }
      ]
    });

    s3SendMock.mockImplementation(async (command: unknown) => {
      if (command instanceof HeadObjectCommand) {
        throw Object.assign(new Error("Not found"), { name: "NotFound" });
      }

      return {};
    });

    await expect(
      runNamespaceMediaAssets({
        apply: false,
        bucket: "hidden-adventures-nonprod",
        reportPath
      })
    ).rejects.toThrow("Preflight failed");

    const written = JSON.parse(await readFile(reportPath, "utf8")) as NamespaceReport;
    expect(written.missingSources).toBe(1);
    expect(written.entries[0]?.status).toBe("missing_source");

    await unlink(reportPath);
  });
});
