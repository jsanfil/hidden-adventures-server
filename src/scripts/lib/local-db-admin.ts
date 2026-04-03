import { Pool } from "pg";

import { env } from "../../config/env.js";

function adminPool() {
  return new Pool({
    host: env.POSTGRES_HOST,
    port: env.POSTGRES_PORT,
    database: "postgres",
    user: env.POSTGRES_USER,
    password: env.POSTGRES_PASSWORD
  });
}

function quoteIdentifier(value: string): string {
  return `"${value.replace(/"/g, "\"\"")}"`;
}

export async function createDatabaseIfMissing(databaseName = env.POSTGRES_DB): Promise<boolean> {
  const pool = adminPool();

  try {
    const existing = await pool.query<{ exists: boolean }>(
      "select exists(select 1 from pg_database where datname = $1) as exists",
      [databaseName]
    );

    if (existing.rows[0]?.exists) {
      return false;
    }

    await pool.query(`create database ${quoteIdentifier(databaseName)}`);
    return true;
  } finally {
    await pool.end();
  }
}

export async function resetDatabase(databaseName = env.POSTGRES_DB): Promise<void> {
  const pool = adminPool();

  try {
    await pool.query(
      `
        select pg_terminate_backend(pid)
        from pg_stat_activity
        where datname = $1
          and pid <> pg_backend_pid()
      `,
      [databaseName]
    );

    await pool.query(`drop database if exists ${quoteIdentifier(databaseName)}`);
    await pool.query(`create database ${quoteIdentifier(databaseName)}`);
  } finally {
    await pool.end();
  }
}
