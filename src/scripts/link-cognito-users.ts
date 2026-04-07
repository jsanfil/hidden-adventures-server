import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { PoolClient } from "pg";

import { db } from "../db/client.js";

type CognitoAttribute = {
  Name?: string;
  Value?: string;
};

type CognitoUser = {
  Username?: string;
  Attributes?: CognitoAttribute[];
};

type CognitoExport = {
  Users?: CognitoUser[];
};

type UsersWorkRow = {
  user_id: string;
  handle: string;
  email: string | null;
  cognito_subject: string | null;
};

type LinkAction = "linked_by_username" | "linked_by_unique_email" | "manual_review_required";

type LinkReportEntry = {
  action: LinkAction;
  cognitoUsername: string;
  cognitoSub: string | null;
  email: string | null;
  matchedUserId?: string;
  matchedHandle?: string;
  reason: string;
};

type CliOptions = {
  inputPath: string;
  runId: number;
  apply: boolean;
  reportPath?: string;
};

function actionPriority(action: LinkAction): number {
  switch (action) {
    case "linked_by_username":
      return 0;
    case "linked_by_unique_email":
      return 1;
    case "manual_review_required":
      return 2;
  }
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function parseArgs(argv: string[]): CliOptions {
  let inputPath: string | undefined;
  let runId: number | undefined;
  let apply = false;
  let reportPath: string | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--input") {
      inputPath = argv[index + 1];
      index += 1;
      continue;
    }

    if (arg === "--run-id") {
      const value = Number(argv[index + 1]);
      if (!Number.isInteger(value) || value <= 0) {
        throw new Error("Expected a positive integer after --run-id.");
      }
      runId = value;
      index += 1;
      continue;
    }

    if (arg === "--apply") {
      apply = true;
      continue;
    }

    if (arg === "--report") {
      reportPath = argv[index + 1];
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!inputPath) {
    throw new Error("Missing required --input <path> argument.");
  }

  if (!runId) {
    throw new Error("Missing required --run-id <number> argument.");
  }

  return {
    inputPath,
    runId,
    apply,
    reportPath
  };
}

function normalizeEmail(email: string | null | undefined): string | null {
  if (!email) {
    return null;
  }

  const trimmed = email.trim().toLowerCase();
  return trimmed.length > 0 ? trimmed : null;
}

function getAttribute(user: CognitoUser, name: string): string | null {
  const attribute = user.Attributes?.find((item) => item.Name === name)?.Value;
  return attribute?.trim() || null;
}

async function loadCognitoUsers(inputPath: string): Promise<CognitoUser[]> {
  const raw = await readFile(inputPath, "utf8");
  const parsed = JSON.parse(raw) as CognitoExport | CognitoUser[];

  if (Array.isArray(parsed)) {
    return parsed;
  }

  if (Array.isArray(parsed.Users)) {
    return parsed.Users;
  }

  throw new Error("Unsupported Cognito export format. Expected an array or an object with a Users array.");
}

async function getUsersWorkRows(client: PoolClient, runId: number): Promise<UsersWorkRow[]> {
  const result = await client.query<UsersWorkRow>(
    `
      select
        user_id::text as user_id,
        handle,
        email,
        cognito_subject
      from migration_work.users_work
      where run_id = $1
    `,
    [runId]
  );

  return result.rows;
}

async function appendAuditRow(
  client: PoolClient,
  runId: number,
  entry: LinkReportEntry
): Promise<number> {
  const result = await client.query(
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
    [
      runId,
      "cognito_users",
      entry.cognitoUsername,
      entry.action,
      entry.reason,
      JSON.stringify({
        cognitoUsername: entry.cognitoUsername,
        cognitoSub: entry.cognitoSub,
        email: entry.email,
        matchedUserId: entry.matchedUserId ?? null,
        matchedHandle: entry.matchedHandle ?? null
      })
    ]
  );

  return result.rowCount ?? 0;
}

async function updateLinkedUser(
  client: PoolClient,
  runId: number,
  entry: LinkReportEntry
): Promise<number> {
  if (!entry.matchedUserId || !entry.cognitoSub) {
    return 0;
  }

  const linkSource =
    entry.action === "linked_by_username" ? "username" : "unique_email";

  const result = await client.query(
    `
      update migration_work.users_work
      set
        cognito_subject = $1,
        linked_at = now(),
        link_source = $2
      where run_id = $3
        and user_id = $4::uuid
        and (cognito_subject is null or cognito_subject = $1)
    `,
    [entry.cognitoSub, linkSource, runId, entry.matchedUserId]
  );

  return result.rowCount ?? 0;
}

function buildLinkEntry(
  user: CognitoUser,
  usersByHandle: Map<string, UsersWorkRow>,
  usersByEmail: Map<string, UsersWorkRow[]>
): LinkReportEntry {
  const cognitoUsername = user.Username?.trim();
  if (!cognitoUsername) {
    return {
      action: "manual_review_required",
      cognitoUsername: "",
      cognitoSub: null,
      email: normalizeEmail(getAttribute(user, "email")),
      reason: "Missing Cognito username."
    };
  }

  const cognitoSub = getAttribute(user, "sub");
  const email = normalizeEmail(getAttribute(user, "email"));

  const usernameMatch = usersByHandle.get(cognitoUsername);
  if (usernameMatch) {
    return {
      action: "linked_by_username",
      cognitoUsername,
      cognitoSub,
      email,
      matchedUserId: usernameMatch.user_id,
      matchedHandle: usernameMatch.handle,
      reason: "Matched imported user by exact Cognito username."
    };
  }

  if (email) {
    const emailMatches = usersByEmail.get(email) ?? [];
    if (emailMatches.length === 1) {
      return {
        action: "linked_by_unique_email",
        cognitoUsername,
        cognitoSub,
        email,
        matchedUserId: emailMatches[0].user_id,
        matchedHandle: emailMatches[0].handle,
        reason: "Matched imported user by unique legacy email."
      };
    }

    if (emailMatches.length > 1) {
      return {
        action: "manual_review_required",
        cognitoUsername,
        cognitoSub,
        email,
        reason: "Email matched multiple imported users."
      };
    }
  }

  return {
    action: "manual_review_required",
    cognitoUsername,
    cognitoSub,
    email,
    reason: "No imported user matched by username or unique email."
  };
}

async function run() {
  const options = parseArgs(process.argv.slice(2));
  const users = await loadCognitoUsers(path.resolve(__dirname, "../../", options.inputPath));

  await db.withTransaction(async (client) => {
    const workRows = await getUsersWorkRows(client, options.runId);
    const usersByHandle = new Map(workRows.map((row) => [row.handle, row]));
    const usersByEmail = new Map<string, UsersWorkRow[]>();

    for (const row of workRows) {
      const normalizedEmail = normalizeEmail(row.email);
      if (!normalizedEmail) {
        continue;
      }
      const existing = usersByEmail.get(normalizedEmail) ?? [];
      existing.push(row);
      usersByEmail.set(normalizedEmail, existing);
    }

    const report: LinkReportEntry[] = [];
    for (const user of users) {
      const entry = buildLinkEntry(user, usersByHandle, usersByEmail);
      report.push(entry);
    }

    let persistedAuditRows = 0;
    let persistedUserLinks = 0;
    const entriesToPersist = [...report].sort(
      (left, right) => actionPriority(left.action) - actionPriority(right.action)
    );

    if (options.apply) {
      for (const entry of entriesToPersist) {
        persistedAuditRows += await appendAuditRow(client, options.runId, entry);
        persistedUserLinks += await updateLinkedUser(client, options.runId, entry);
      }
    }

    if (options.reportPath) {
      const outputPath = path.resolve(process.cwd(), options.reportPath);
      await writeFile(outputPath, JSON.stringify(report, null, 2) + "\n", "utf8");
    }

    const linkedByUsername = report.filter((entry) => entry.action === "linked_by_username").length;
    const linkedByUniqueEmail = report.filter((entry) => entry.action === "linked_by_unique_email").length;
    const manualReviewRequired = report.filter((entry) => entry.action === "manual_review_required").length;
    const expectedPersistedLinks = new Set(
      report
        .filter(
          (entry) =>
            entry.action !== "manual_review_required" &&
            Boolean(entry.matchedUserId) &&
            Boolean(entry.cognitoSub)
        )
        .map((entry) => entry.matchedUserId)
    ).size;

    if (options.apply && persistedUserLinks !== expectedPersistedLinks) {
      throw new Error(
        `Expected to persist ${expectedPersistedLinks} Cognito links, but updated ${persistedUserLinks} rows.`
      );
    }

    console.log(
      JSON.stringify(
        {
          apply: options.apply,
          runId: options.runId,
          linkedByUsername,
          linkedByUniqueEmail,
          manualReviewRequired,
          persistedAuditRows,
          persistedUserLinks
        },
        null,
        2
      )
    );
  });
}

run()
  .catch((error: unknown) => {
    console.error("Cognito linking job failed.", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.close();
  });
