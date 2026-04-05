import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { env } from "../config/env.js";
import { listCognitoUsers } from "../features/auth/cognito.js";

type CliOptions = {
  outputDir?: string;
};

function parseArgs(argv: string[]): CliOptions {
  let outputDir: string | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--output-dir") {
      outputDir = argv[index + 1];
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return { outputDir };
}

function resolveExportDir(overrideDir?: string, homeDir = process.env.HOME): string {
  if (overrideDir) {
    return path.resolve(overrideDir);
  }

  if (homeDir) {
    return path.join(homeDir, ".hidden-adventures", "backups", "cognito");
  }

  return path.resolve(".tmp", "cognito");
}

function buildExportPath(outputDir: string, poolId: string, date = new Date()): string {
  const timestamp = date.toISOString().replace(/[:.]/g, "-");
  return path.join(outputDir, `cognito-users-${poolId}-${timestamp}.json`);
}

async function main() {
  if (!env.COGNITO_USER_POOL_ID) {
    throw new Error("COGNITO_USER_POOL_ID is required to export Cognito users.");
  }

  const options = parseArgs(process.argv.slice(2));
  const outputDir = resolveExportDir(options.outputDir);
  await mkdir(outputDir, { recursive: true });

  const users = await listCognitoUsers();
  const exportPayload = users.map((user) => ({
    Username: user.username,
    Attributes: [
      { Name: "sub", Value: user.sub },
      ...(user.email ? [{ Name: "email", Value: user.email }] : []),
      { Name: "email_verified", Value: user.emailVerified ? "true" : "false" }
    ]
  }));

  const outputPath = buildExportPath(outputDir, env.COGNITO_USER_POOL_ID);
  await writeFile(outputPath, JSON.stringify(exportPayload, null, 2));

  console.log(
    JSON.stringify(
      {
        userPoolId: env.COGNITO_USER_POOL_ID,
        exportedUsers: exportPayload.length,
        outputPath
      },
      null,
      2
    )
  );
}

void main().catch((error: unknown) => {
  console.error("Cognito user export failed.", error);
  process.exitCode = 1;
});
