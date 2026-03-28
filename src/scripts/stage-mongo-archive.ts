import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { PoolClient } from "pg";

import { db } from "../db/client.js";
import {
  readMongoArchive,
  sha256File,
  type MongoArchiveDocument
} from "./lib/mongo-archive.js";

type CliOptions = {
  archivePath: string;
  reportPath?: string;
  notes?: string;
};

type InsertTarget = {
  collectionName: string;
  tableName: string;
};

type ImportRunRow = {
  id: number;
};

type StageSummary = {
  runId: number;
  archivePath: string;
  archiveChecksum: string;
  stagedCollections: Array<{
    collection: string;
    table: string;
    count: number;
  }>;
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const stageTargets: InsertTarget[] = [
  { collectionName: "profiles", tableName: "profiles_raw" },
  { collectionName: "adventures", tableName: "adventures_raw" },
  { collectionName: "sidekicks", tableName: "sidekicks_raw" },
  { collectionName: "favorites", tableName: "favorites_raw" },
  { collectionName: "comments", tableName: "comments_raw" }
];

function parseArgs(argv: string[]): CliOptions {
  let archivePath: string | undefined;
  let reportPath: string | undefined;
  let notes: string | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--archive") {
      archivePath = argv[index + 1];
      index += 1;
      continue;
    }

    if (arg === "--report") {
      reportPath = argv[index + 1];
      index += 1;
      continue;
    }

    if (arg === "--notes") {
      notes = argv[index + 1];
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!archivePath) {
    throw new Error("Missing required --archive <path> argument.");
  }

  return {
    archivePath,
    reportPath,
    notes
  };
}

function buildSourceKey(document: MongoArchiveDocument, index: number): string {
  const id = document._id;

  if (typeof id === "string" && id.length > 0) {
    return id;
  }

  return `row-${index + 1}`;
}

async function createImportRun(
  client: PoolClient,
  archivePath: string,
  archiveChecksum: string,
  notes?: string
): Promise<number> {
  const result = await client.query<ImportRunRow>(
    `
      insert into migration_meta.import_runs (
        archive_path,
        archive_checksum,
        status,
        notes
      ) values ($1, $2, $3, $4)
      returning id
    `,
    [archivePath, archiveChecksum, "staging_raw", notes ?? null]
  );

  return result.rows[0].id;
}

async function stageCollection(
  client: PoolClient,
  runId: number,
  tableName: string,
  documents: MongoArchiveDocument[]
): Promise<number> {
  if (documents.length === 0) {
    return 0;
  }

  for (let index = 0; index < documents.length; index += 1) {
    const document = documents[index];
    const sourceKey = buildSourceKey(document, index);

    await client.query(
      `
        insert into migration_stage.${tableName} (
          run_id,
          source_key,
          payload_json
        ) values ($1, $2, $3::jsonb)
      `,
      [runId, sourceKey, JSON.stringify(document)]
    );
  }

  return documents.length;
}

async function recordMetric(
  client: PoolClient,
  runId: number,
  metricName: string,
  metricValue: number,
  details: Record<string, unknown>
) {
  await client.query(
    `
      insert into migration_meta.import_metrics (
        run_id,
        metric_name,
        metric_value,
        details_json
      ) values ($1, $2, $3, $4::jsonb)
    `,
    [runId, metricName, metricValue, JSON.stringify(details)]
  );
}

async function finalizeImportRun(client: PoolClient, runId: number) {
  await client.query(
    `
      update migration_meta.import_runs
      set
        status = 'raw_staged',
        completed_at = now()
      where id = $1
    `,
    [runId]
  );
}

async function writeReport(reportPath: string, summary: StageSummary) {
  const absoluteReportPath = path.resolve(process.cwd(), reportPath);
  await mkdir(path.dirname(absoluteReportPath), { recursive: true });
  await writeFile(absoluteReportPath, JSON.stringify(summary, null, 2) + "\n", "utf8");
}

async function run() {
  const options = parseArgs(process.argv.slice(2));
  const absoluteArchivePath = path.resolve(__dirname, "../../", options.archivePath);
  const [collections, archiveChecksum] = await Promise.all([
    readMongoArchive(absoluteArchivePath),
    sha256File(absoluteArchivePath)
  ]);

  const summary = await db.withTransaction<StageSummary>(async (client) => {
    const runId = await createImportRun(
      client,
      absoluteArchivePath,
      archiveChecksum,
      options.notes
    );

    const stagedCollections: StageSummary["stagedCollections"] = [];

    for (const target of stageTargets) {
      const documents = collections[target.collectionName] ?? [];
      const count = await stageCollection(client, runId, target.tableName, documents);
      stagedCollections.push({
        collection: target.collectionName,
        table: target.tableName,
        count
      });
      await recordMetric(client, runId, `raw_stage.${target.collectionName}`, count, {
        tableName: target.tableName
      });
    }

    await finalizeImportRun(client, runId);

    return {
      runId,
      archivePath: absoluteArchivePath,
      archiveChecksum,
      stagedCollections
    };
  });

  if (options.reportPath) {
    await writeReport(options.reportPath, summary);
  }

  console.log(JSON.stringify(summary, null, 2));
}

run()
  .catch((error: unknown) => {
    console.error("Mongo archive staging failed.", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.close();
  });
