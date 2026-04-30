import { randomUUID } from "node:crypto";

import type { PoolClient, QueryResult, QueryResultRow } from "pg";

import { db } from "../../db/client.js";
import { normalizeApiTimestamp, type ApiTimestampInput } from "../../lib/api-timestamp.js";

export type AccountOrigin = "legacy_profile_import" | "rebuild_signup";

type Queryable = PoolClient | typeof db;

type LocalUserRow = QueryResultRow & {
  id: string;
  cognito_subject: string | null;
  handle: string;
  email: string | null;
  account_origin: AccountOrigin;
  status: string;
  created_at: ApiTimestampInput;
  updated_at: ApiTimestampInput;
};

export type LocalUser = {
  id: string;
  cognitoSubject: string | null;
  handle: string;
  email: string | null;
  accountOrigin: AccountOrigin;
  status: string;
  createdAt: string;
  updatedAt: string;
};

type CreateUserInput = {
  cognitoSubject: string;
  handle: string;
  email: string | null;
};

function mapLocalUser(row: LocalUserRow): LocalUser {
  return {
    id: row.id,
    cognitoSubject: row.cognito_subject,
    handle: row.handle,
    email: row.email,
    accountOrigin: row.account_origin,
    status: row.status,
    createdAt: normalizeApiTimestamp(row.created_at)!,
    updatedAt: normalizeApiTimestamp(row.updated_at)!
  };
}

function getExecutor(client?: PoolClient): Queryable {
  return client ?? db;
}

async function runQuery<TResult extends QueryResultRow>(
  client: PoolClient | undefined,
  text: string,
  values: unknown[]
): Promise<QueryResult<TResult>> {
  const executor = getExecutor(client) as {
    query: (sql: string, params: unknown[]) => Promise<QueryResult<TResult>>;
  };

  return executor.query(text, values);
}

export async function getUserByCognitoSubject(
  cognitoSubject: string,
  client?: PoolClient
): Promise<LocalUser | null> {
  const result = await runQuery<LocalUserRow>(
    client,
    `
      select
        id::text as id,
        cognito_subject,
        handle,
        email,
        account_origin,
        status,
        created_at as created_at,
        updated_at as updated_at
      from public.users
      where cognito_subject = $1
      limit 1
    `,
    [cognitoSubject]
  );

  const row = result.rows[0];
  return row ? mapLocalUser(row) : null;
}

export async function getUserByHandle(handle: string, client?: PoolClient): Promise<LocalUser | null> {
  const result = await runQuery<LocalUserRow>(
    client,
    `
      select
        id::text as id,
        cognito_subject,
        handle,
        email,
        account_origin,
        status,
        created_at as created_at,
        updated_at as updated_at
      from public.users
      where handle = $1
      limit 1
    `,
    [handle]
  );

  const row = result.rows[0];
  return row ? mapLocalUser(row) : null;
}

export async function getLegacyUserByHandle(
  handle: string,
  client?: PoolClient
): Promise<LocalUser | null> {
  const result = await runQuery<LocalUserRow>(
    client,
    `
      select
        id::text as id,
        cognito_subject,
        handle,
        email,
        account_origin,
        status,
        created_at as created_at,
        updated_at as updated_at
      from public.users
      where handle = $1
        and account_origin = 'legacy_profile_import'
      limit 1
    `,
    [handle]
  );

  const row = result.rows[0];
  return row ? mapLocalUser(row) : null;
}

export async function listLegacyUsersByEmail(
  email: string,
  client?: PoolClient
): Promise<LocalUser[]> {
  const result = await runQuery<LocalUserRow>(
    client,
    `
      select
        id::text as id,
        cognito_subject,
        handle,
        email,
        account_origin,
        status,
        created_at as created_at,
        updated_at as updated_at
      from public.users
      where lower(email) = lower($1)
        and account_origin = 'legacy_profile_import'
      order by created_at asc, id asc
    `,
    [email]
  );

  return result.rows.map(mapLocalUser);
}

export async function linkUserToCognitoSubject(
  userId: string,
  cognitoSubject: string,
  email: string | null,
  client?: PoolClient
): Promise<LocalUser | null> {
  const result = await runQuery<LocalUserRow>(
    client,
    `
      update public.users
      set
        cognito_subject = $2,
        email = coalesce($3, email),
        updated_at = now()
      where id = $1::uuid
        and (cognito_subject is null or cognito_subject = $2)
      returning
        id::text as id,
        cognito_subject,
        handle,
        email,
        account_origin,
        status,
        created_at as created_at,
        updated_at as updated_at
    `,
    [userId, cognitoSubject, email]
  );

  const row = result.rows[0];
  return row ? mapLocalUser(row) : null;
}

export async function createRebuildUser(
  input: CreateUserInput,
  client?: PoolClient
): Promise<LocalUser> {
  const result = await runQuery<LocalUserRow>(
    client,
    `
      insert into public.users (
        id,
        cognito_subject,
        handle,
        email,
        account_origin,
        status,
        created_at,
        updated_at,
        deleted_at
      ) values (
        $1::uuid,
        $2,
        $3,
        $4,
        'rebuild_signup',
        'active',
        now(),
        now(),
        null
      )
      returning
        id::text as id,
        cognito_subject,
        handle,
        email,
        account_origin,
        status,
        created_at as created_at,
        updated_at as updated_at
    `,
    [randomUUID(), input.cognitoSubject, input.handle, input.email]
  );

  return mapLocalUser(result.rows[0]);
}
