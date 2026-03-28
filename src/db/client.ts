import {
  Pool,
  type PoolClient,
  type PoolConfig,
  type QueryResult,
  type QueryResultRow
} from "pg";

import { env } from "../config/env.js";

function buildPoolConfig(): PoolConfig {
  return {
    host: env.POSTGRES_HOST,
    port: env.POSTGRES_PORT,
    database: env.POSTGRES_DB,
    user: env.POSTGRES_USER,
    password: env.POSTGRES_PASSWORD,
    max: 10,
    idleTimeoutMillis: 30_000
  };
}

class DatabaseClient {
  private readonly pool = new Pool(buildPoolConfig());

  async query<TResult extends QueryResultRow>(
    text: string,
    values?: unknown[]
  ): Promise<QueryResult<TResult>> {
    return this.pool.query<TResult>(text, values);
  }

  async withClient<TResult>(callback: (client: PoolClient) => Promise<TResult>): Promise<TResult> {
    const client = await this.pool.connect();

    try {
      return await callback(client);
    } finally {
      client.release();
    }
  }

  async withTransaction<TResult>(
    callback: (client: PoolClient) => Promise<TResult>
  ): Promise<TResult> {
    return this.withClient(async (client) => {
      await client.query("begin");

      try {
        const result = await callback(client);
        await client.query("commit");
        return result;
      } catch (error) {
        await client.query("rollback");
        throw error;
      }
    });
  }

  async checkHealth(): Promise<{ latencyMs: number }> {
    const startedAt = performance.now();

    await this.query("select 1");

    return {
      latencyMs: Math.round((performance.now() - startedAt) * 100) / 100
    };
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

export const db = new DatabaseClient();
