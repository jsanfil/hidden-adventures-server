import type { PoolClient, QueryResult, QueryResultRow } from "pg";

import { db } from "../../db/client.js";
import { normalizeApiTimestamp, type ApiTimestampInput } from "../../lib/api-timestamp.js";
import { visibilityClause } from "../adventures/repository.js";

type Queryable = PoolClient | typeof db;

type InsertMediaAssetInput = {
  id: string;
  ownerUserId: string;
  storageKey: string;
  kind: string;
  mimeType: string;
  byteSize: number;
  width: number | null;
  height: number | null;
};

type OwnedMediaAssetRow = QueryResultRow & {
  id: string;
  storage_key: string;
  mime_type: string | null;
  byte_size: number | null;
  width: number | null;
  height: number | null;
  already_attached: boolean;
};

export type OwnedMediaAsset = {
  id: string;
  storageKey: string;
  mimeType: string | null;
  byteSize: number | null;
  width: number | null;
  height: number | null;
  alreadyAttached: boolean;
};

type MediaDeliveryRow = QueryResultRow & {
  media_id: string;
  storage_key: string;
  mime_type: string | null;
  byte_size: number | null;
  width: number | null;
  height: number | null;
  updated_at: ApiTimestampInput;
};

export type MediaDeliveryTarget = {
  id: string;
  storageKey: string;
  mimeType: string | null;
  byteSize: number | null;
  width: number | null;
  height: number | null;
  updatedAt: string;
};

function executor(client?: PoolClient): Queryable {
  return client ?? db;
}

async function runQuery<TResult extends QueryResultRow>(
  client: PoolClient | undefined,
  text: string,
  values: unknown[]
): Promise<QueryResult<TResult>> {
  const queryable = executor(client) as {
    query: (sql: string, params: unknown[]) => Promise<QueryResult<TResult>>;
  };

  return queryable.query(text, values);
}

export async function insertPendingMediaAssets(
  assets: InsertMediaAssetInput[],
  client?: PoolClient
): Promise<void> {
  for (const asset of assets) {
    await runQuery(
      client,
      `
        insert into public.media_assets (
          id,
          owner_user_id,
          storage_key,
          kind,
          mime_type,
          byte_size,
          width,
          height,
          moderation_status,
          moderation_reason,
          created_at,
          updated_at,
          deleted_at
        ) values (
          $1::uuid,
          $2::uuid,
          $3,
          $4,
          $5,
          $6,
          $7,
          $8,
          'pending',
          null,
          now(),
          now(),
          null
        )
      `,
      [
        asset.id,
        asset.ownerUserId,
        asset.storageKey,
        asset.kind,
        asset.mimeType,
        asset.byteSize,
        asset.width,
        asset.height
      ]
    );
  }
}

export async function listOwnedMediaAssetsForAdventureCreate(options: {
  ownerUserId: string;
  mediaIds: string[];
  client?: PoolClient;
}): Promise<OwnedMediaAsset[]> {
  if (options.mediaIds.length === 0) {
    return [];
  }

  const result = await runQuery<OwnedMediaAssetRow>(
    options.client,
    `
      select
        media_assets.id::text as id,
        media_assets.storage_key,
        media_assets.mime_type,
        media_assets.byte_size,
        media_assets.width,
        media_assets.height,
        exists (
          select 1
          from public.adventure_media
          where adventure_media.media_asset_id = media_assets.id
        ) as already_attached
      from public.media_assets
      where media_assets.owner_user_id = $1::uuid
        and media_assets.id = any($2::uuid[])
        and media_assets.deleted_at is null
        and media_assets.kind = 'adventure_image'
        and media_assets.moderation_status <> 'rejected'
      order by media_assets.created_at asc, media_assets.id asc
    `,
    [options.ownerUserId, options.mediaIds]
  );

  return result.rows.map((row) => ({
    id: row.id,
    storageKey: row.storage_key,
    mimeType: row.mime_type,
    byteSize: row.byte_size,
    width: row.width,
    height: row.height,
    alreadyAttached: row.already_attached
  }));
}

export async function getMediaDeliveryTarget(options: {
  mediaId: string;
  viewerId?: string;
  client?: PoolClient;
}): Promise<MediaDeliveryTarget | null> {
  const result = await runQuery<MediaDeliveryRow>(
    options.client,
    `
      -- Media access is attachment-derived, not based on UUID secrecy or client-supplied context.
      -- Starting from a media asset id, we discover what owns that asset and only return it when
      -- the authenticated viewer may see the owning record.
      --
      -- Supported visibility cases:
      -- - adventure-linked media: use the parent adventure's existing visibility rules
      -- - profile avatar/cover media: allow access for authenticated viewers under the current contract
      -- - any other attachment or no visible attachment: do not resolve a delivery target
      with viewer as (
        select $1::uuid as id
      )
      select
        media_assets.id::text as media_id,
        media_assets.storage_key,
        media_assets.mime_type,
        media_assets.byte_size,
        media_assets.width,
        media_assets.height,
        media_assets.updated_at as updated_at
      from public.media_assets media_assets
      where media_assets.id = $2::uuid
        and media_assets.deleted_at is null
        and media_assets.moderation_status <> 'rejected'
        and (
          exists (
            select 1
            from public.adventure_media adventure_media
            join public.adventures adventures
              on adventures.id = adventure_media.adventure_id
            where adventure_media.media_asset_id = media_assets.id
              and adventures.status = 'published'
              and ${visibilityClause()}
          )
          or exists (
            select 1
            from public.profiles profiles
            where profiles.avatar_media_asset_id = media_assets.id
               or profiles.cover_media_asset_id = media_assets.id
          )
        )
      limit 1
    `,
    [options.viewerId ?? null, options.mediaId]
  );

  const row = result.rows[0];
  if (!row) {
    return null;
  }

  return {
    id: row.media_id,
    storageKey: row.storage_key,
    mimeType: row.mime_type,
    byteSize: row.byte_size,
    width: row.width,
    height: row.height,
    updatedAt: normalizeApiTimestamp(row.updated_at)!
  };
}
