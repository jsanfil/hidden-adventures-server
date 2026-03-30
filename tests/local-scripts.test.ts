import { beforeEach, describe, expect, it, vi } from "vitest";

const { createLocalPostgresBackupMock, dbMock } = vi.hoisted(() => ({
  createLocalPostgresBackupMock: vi.fn(),
  dbMock: {
    withTransaction: vi.fn(),
    close: vi.fn()
  }
}));

vi.mock("../src/scripts/backup-local-postgres.js", async () => {
  const actual = await vi.importActual("../src/scripts/backup-local-postgres.js");

  return {
    ...actual,
    createLocalPostgresBackup: createLocalPostgresBackupMock
  };
});

vi.mock("../src/db/client.js", () => ({
  db: dbMock
}));

describe("local backup and seed scripts", () => {
  beforeEach(() => {
    createLocalPostgresBackupMock.mockReset();
    dbMock.withTransaction.mockReset();
    dbMock.close.mockReset();
    dbMock.withTransaction.mockImplementation(async (callback: (client: { query: ReturnType<typeof vi.fn> }) => Promise<void>) =>
      callback({ query: vi.fn().mockResolvedValue({ rows: [] }) })
    );
  });

  it("builds backups outside the repo by default", async () => {
    const { buildBackupFilePath, resolveLocalBackupDir } = await import(
      "../src/scripts/backup-local-postgres.js"
    );

    const backupDir = resolveLocalBackupDir(undefined, undefined, "/Users/tester");
    const outputPath = buildBackupFilePath(backupDir, new Date("2026-03-29T17:00:00.000Z"));

    expect(backupDir).toBe("/Users/tester/.hidden-adventures/backups/postgres");
    expect(outputPath).toContain("/Users/tester/.hidden-adventures/backups/postgres/");
    expect(outputPath).toContain("hidden-adventures-local-2026-03-29T17-00-00-000Z.dump");
  });

  it("creates a backup before mutating local fixtures", async () => {
    createLocalPostgresBackupMock.mockResolvedValue("/tmp/local-backup.dump");

    const { seedLocalFixtures } = await import("../src/scripts/seed-local-fixtures.js");

    const summary = await seedLocalFixtures();

    expect(createLocalPostgresBackupMock).toHaveBeenCalledTimes(1);
    expect(dbMock.withTransaction).toHaveBeenCalledTimes(1);
    expect(summary.backupPath).toBe("/tmp/local-backup.dump");
    expect(summary.profileHandle).toBe("fixture_author");
  });

  it("does not start fixture writes when backup creation fails", async () => {
    createLocalPostgresBackupMock.mockRejectedValue(new Error("backup failed"));

    const { seedLocalFixtures } = await import("../src/scripts/seed-local-fixtures.js");

    await expect(seedLocalFixtures()).rejects.toThrow("backup failed");
    expect(dbMock.withTransaction).not.toHaveBeenCalled();
  });
});
