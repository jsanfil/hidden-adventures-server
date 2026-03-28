import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { PoolClient } from "pg";

import { db } from "../db/client.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const migrationsDir = path.resolve(__dirname, "../../db/migrations");

type AppliedMigrationRow = {
  name: string;
};

async function ensureSchemaMigrationsTable(client: PoolClient) {
  await client.query(`
    create table if not exists public.schema_migrations (
      name text primary key,
      applied_at timestamptz not null default now()
    )
  `);
}

async function listMigrationFiles(): Promise<string[]> {
  const entries = await readdir(migrationsDir, { withFileTypes: true });

  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".sql"))
    .map((entry) => entry.name)
    .sort();
}

async function getAppliedMigrations(client: PoolClient): Promise<Set<string>> {
  const result = await client.query<AppliedMigrationRow>(
    "select name from public.schema_migrations"
  );

  return new Set(result.rows.map((row) => row.name));
}

async function applyMigration(client: PoolClient, name: string) {
  const migrationPath = path.join(migrationsDir, name);
  const sql = await readFile(migrationPath, "utf8");

  await client.query("begin");
  try {
    await client.query(sql);
    await client.query("insert into public.schema_migrations (name) values ($1)", [name]);
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  }
}

async function main() {
  await db.withClient(async (client) => {
    await ensureSchemaMigrationsTable(client);

    const [files, applied] = await Promise.all([
      listMigrationFiles(),
      getAppliedMigrations(client)
    ]);

    const pending = files.filter((name) => !applied.has(name));

    if (pending.length === 0) {
      console.log("No pending migrations.");
      return;
    }

    for (const name of pending) {
      await applyMigration(client, name);
      console.log(`Applied migration ${name}`);
    }
  });
}

main()
  .catch((error: unknown) => {
    console.error("Migration run failed.", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.close();
  });
