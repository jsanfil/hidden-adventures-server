import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  CopyObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  NoSuchKey,
  NotFound,
  S3Client
} from "@aws-sdk/client-s3";

import { db } from "../db/client.js";
import { env } from "../config/env.js";

const DEFAULT_BUCKET = "hidden-adventures-nonprod";
const __filename = fileURLToPath(import.meta.url);

const KIND_PREFIXES = {
  adventure_image: "adventures",
  profile_avatar: "profile-avatars",
  profile_cover: "profile-covers"
} as const;

type SupportedKind = keyof typeof KIND_PREFIXES;

export type CliOptions = {
  apply: boolean;
  bucket: string;
  reportPath?: string;
};

export type MediaAssetRow = {
  id: string;
  kind: string;
  storage_key: string;
};

export type ReportEntryStatus =
  | "planned"
  | "already_namespaced"
  | "migrated"
  | "skipped"
  | "collision"
  | "missing_source";

export type ReportEntry = {
  mediaAssetId: string;
  kind: string;
  oldKey: string;
  newKey: string;
  status: ReportEntryStatus;
  reason?: string;
};

export type NamespaceReport = {
  apply: boolean;
  bucket: string;
  examined: number;
  eligible: number;
  alreadyNamespaced: number;
  planned: number;
  migrated: number;
  skipped: number;
  collisions: number;
  missingSources: number;
  entries: ReportEntry[];
};

type PlannedMigration = {
  mediaAssetId: string;
  kind: SupportedKind;
  oldKey: string;
  newKey: string;
};

type HeadResult =
  | { exists: true }
  | {
      exists: false;
      code?: string;
    };

function createEmptyReport(options: CliOptions): NamespaceReport {
  return {
    apply: options.apply,
    bucket: options.bucket,
    examined: 0,
    eligible: 0,
    alreadyNamespaced: 0,
    planned: 0,
    migrated: 0,
    skipped: 0,
    collisions: 0,
    missingSources: 0,
    entries: []
  };
}

export function parseArgs(argv: string[]): CliOptions {
  let apply = false;
  let bucket = DEFAULT_BUCKET;
  let reportPath: string | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--apply") {
      apply = true;
      continue;
    }

    if (arg === "--report") {
      reportPath = argv[index + 1];
      index += 1;
      continue;
    }

    if (arg === "--bucket") {
      bucket = argv[index + 1] ?? bucket;
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return {
    apply,
    bucket,
    reportPath
  };
}

export function isSupportedKind(value: string): value is SupportedKind {
  return value in KIND_PREFIXES;
}

export function basenameFromStorageKey(storageKey: string): string {
  const normalized = storageKey.trim().replace(/\/+$/g, "");
  const parts = normalized.split("/").filter((part) => part.length > 0);

  if (parts.length === 0) {
    throw new Error(`Cannot derive basename from empty storage key "${storageKey}".`);
  }

  return parts.at(-1)!;
}

export function buildNamespacedKey(kind: SupportedKind, storageKey: string): string {
  return `${KIND_PREFIXES[kind]}/${basenameFromStorageKey(storageKey)}`;
}

export function isAlreadyNamespaced(kind: SupportedKind, storageKey: string): boolean {
  return storageKey === buildNamespacedKey(kind, storageKey);
}

export async function listTargetRows(): Promise<MediaAssetRow[]> {
  const result = await db.query<MediaAssetRow>(
    `
      select
        id::text as id,
        kind,
        storage_key
      from public.media_assets
      where kind = any($1::text[])
        and deleted_at is null
      order by id asc
    `,
    [Object.keys(KIND_PREFIXES)]
  );

  return result.rows;
}

export function planNamespaceMigration(
  rows: MediaAssetRow[],
  options: CliOptions
): {
  report: NamespaceReport;
  plannedMigrations: PlannedMigration[];
} {
  const report = createEmptyReport(options);
  const plannedMigrations: PlannedMigration[] = [];
  const newKeyToOldKey = new Map<string, string>();

  report.examined = rows.length;

  for (const row of rows) {
    if (!isSupportedKind(row.kind)) {
      report.skipped += 1;
      report.entries.push({
        mediaAssetId: row.id,
        kind: row.kind,
        oldKey: row.storage_key,
        newKey: row.storage_key,
        status: "skipped",
        reason: "Unsupported media kind."
      });
      continue;
    }

    const newKey = buildNamespacedKey(row.kind, row.storage_key);

    if (row.storage_key === newKey) {
      report.alreadyNamespaced += 1;
      report.entries.push({
        mediaAssetId: row.id,
        kind: row.kind,
        oldKey: row.storage_key,
        newKey,
        status: "already_namespaced",
        reason: "Storage key already matches the expected namespace."
      });
      continue;
    }

    const existingSource = newKeyToOldKey.get(newKey);
    if (existingSource) {
      report.collisions += 1;
      report.entries.push({
        mediaAssetId: row.id,
        kind: row.kind,
        oldKey: row.storage_key,
        newKey,
        status: "collision",
        reason: `Target key collides with another source key (${existingSource}).`
      });
      continue;
    }

    newKeyToOldKey.set(newKey, row.storage_key);
    report.eligible += 1;
    report.planned += 1;

    const entry: ReportEntry = {
      mediaAssetId: row.id,
      kind: row.kind,
      oldKey: row.storage_key,
      newKey,
      status: "planned"
    };

    report.entries.push(entry);
    plannedMigrations.push({
      mediaAssetId: row.id,
      kind: row.kind,
      oldKey: row.storage_key,
      newKey
    });
  }

  return {
    report,
    plannedMigrations
  };
}

async function headObject(client: S3Client, bucket: string, key: string): Promise<HeadResult> {
  try {
    await client.send(
      new HeadObjectCommand({
        Bucket: bucket,
        Key: key
      })
    );

    return { exists: true };
  } catch (error) {
    if (
      error instanceof NotFound ||
      error instanceof NoSuchKey ||
      (typeof error === "object" &&
        error !== null &&
        "name" in error &&
        typeof error.name === "string" &&
        ["NotFound", "NoSuchKey", "NoSuchBucket"].includes(error.name))
    ) {
      return {
        exists: false,
        code:
          typeof error === "object" && error !== null && "name" in error && typeof error.name === "string"
            ? error.name
            : undefined
      };
    }

    throw error;
  }
}

function getEntryById(report: NamespaceReport, mediaAssetId: string): ReportEntry {
  const entry = report.entries.find((item) => item.mediaAssetId === mediaAssetId);

  if (!entry) {
    throw new Error(`Missing report entry for media asset ${mediaAssetId}.`);
  }

  return entry;
}

export async function preflightMigrations(
  client: S3Client,
  plannedMigrations: PlannedMigration[],
  report: NamespaceReport,
  bucket: string
): Promise<void> {
  for (const migration of plannedMigrations) {
    const entry = getEntryById(report, migration.mediaAssetId);
    const sourceResult = await headObject(client, bucket, migration.oldKey);

    if (!sourceResult.exists) {
      entry.status = "missing_source";
      entry.reason = "Source object is missing from S3.";
      report.missingSources += 1;
      report.planned -= 1;
      continue;
    }

    const targetResult = await headObject(client, bucket, migration.newKey);

    if (targetResult.exists) {
      entry.status = "collision";
      entry.reason = "Target key already exists in S3.";
      report.collisions += 1;
      report.planned -= 1;
      continue;
    }
  }

  if (report.collisions > 0 || report.missingSources > 0) {
    throw new Error(
      `Preflight failed with ${report.collisions} collision(s) and ${report.missingSources} missing source object(s).`
    );
  }
}

export async function applyMigrations(
  client: S3Client,
  plannedMigrations: PlannedMigration[],
  report: NamespaceReport,
  bucket: string
): Promise<void> {
  for (const migration of plannedMigrations) {
    const entry = getEntryById(report, migration.mediaAssetId);

    if (entry.status !== "planned") {
      continue;
    }

    const sourceResult = await headObject(client, bucket, migration.oldKey);
    if (!sourceResult.exists) {
      entry.status = "missing_source";
      entry.reason = "Source object is missing from S3.";
      report.missingSources += 1;
      report.planned -= 1;
      throw new Error(`Source object "${migration.oldKey}" is missing from S3.`);
    }

    const targetResult = await headObject(client, bucket, migration.newKey);
    if (targetResult.exists) {
      entry.status = "collision";
      entry.reason = "Target key already exists in S3.";
      report.collisions += 1;
      report.planned -= 1;
      throw new Error(`Target object "${migration.newKey}" already exists in S3.`);
    }

    await client.send(
      new CopyObjectCommand({
        Bucket: bucket,
        Key: migration.newKey,
        CopySource: `${bucket}/${migration.oldKey}`
      })
    );

    const updateResult = await db.query(
      `
        update public.media_assets
        set storage_key = $1
        where id = $2::uuid
          and storage_key = $3
      `,
      [migration.newKey, migration.mediaAssetId, migration.oldKey]
    );

    if (updateResult.rowCount !== 1) {
      throw new Error(
        `Expected exactly one media_assets row to update for media asset ${migration.mediaAssetId}.`
      );
    }

    await client.send(
      new DeleteObjectCommand({
        Bucket: bucket,
        Key: migration.oldKey
      })
    );

    entry.status = "migrated";
    report.migrated += 1;
    report.planned -= 1;
  }
}

async function writeReport(reportPath: string, report: NamespaceReport): Promise<void> {
  const outputPath = path.resolve(process.cwd(), reportPath);
  await writeFile(outputPath, JSON.stringify(report, null, 2) + "\n", "utf8");
}

export async function runNamespaceMediaAssets(options: CliOptions): Promise<NamespaceReport> {
  const rows = await listTargetRows();
  const client = new S3Client({ region: env.AWS_REGION });
  const { report, plannedMigrations } = planNamespaceMigration(rows, options);

  try {
    await preflightMigrations(client, plannedMigrations, report, options.bucket);

    if (options.apply) {
      await applyMigrations(client, plannedMigrations, report, options.bucket);
    }
  } finally {
    if (options.reportPath) {
      await writeReport(options.reportPath, report);
    }
  }

  return report;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const report = await runNamespaceMediaAssets(options);
  console.log(JSON.stringify(report, null, 2));
}

function isDirectExecution(): boolean {
  const entry = process.argv[1];
  return entry ? path.resolve(entry) === __filename : false;
}

if (isDirectExecution()) {
  void main()
    .catch((error: unknown) => {
      console.error("Media asset namespace migration failed.", error);
      process.exitCode = 1;
    })
    .finally(async () => {
      await db.close();
    });
}
