import { createHash } from "node:crypto";

import type { PoolClient } from "pg";

export function stableUuid(seed: string): string {
  const digest = createHash("sha1").update(seed).digest();
  const bytes = Buffer.from(digest.subarray(0, 16));

  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = bytes.toString("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32)
  ].join("-");
}

export function coerceTimestamp(value: unknown, fallback: Date = new Date()): string {
  if (typeof value === "string") {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString();
    }
  }

  return fallback.toISOString();
}

export function nullableString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export async function insertImportMap(
  client: PoolClient,
  runId: number,
  mapType: string,
  legacyKey: string,
  newId: string
) {
  await client.query(
    `
      insert into migration_work.import_maps (
        run_id,
        map_type,
        legacy_key,
        new_id
      ) values ($1, $2, $3, $4::uuid)
      on conflict (run_id, map_type, legacy_key)
      do update set new_id = excluded.new_id
    `,
    [runId, mapType, legacyKey, newId]
  );
}

export async function appendImportAudit(
  client: PoolClient,
  runId: number,
  sourceCollection: string,
  sourceKey: string,
  action: string,
  reason: string,
  payload: unknown
) {
  await client.query(
    `
      insert into migration_meta.import_audit (
        run_id,
        source_collection,
        source_key,
        action,
        reason,
        payload_json
      ) values ($1, $2, $3, $4, $5, $6::jsonb)
    `,
    [runId, sourceCollection, sourceKey, action, reason, JSON.stringify(payload)]
  );
}
