import { writeFile } from "node:fs/promises";
import path from "node:path";

import { createCognitoIdentityProviderClient, listCognitoUsers } from "../features/auth/cognito.js";
import { reconcileLegacyIdentity } from "../features/auth/service.js";
import { db } from "../db/client.js";

type CliOptions = {
  apply: boolean;
  reportPath?: string;
};

function parseArgs(argv: string[]): CliOptions {
  let apply = false;
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

    throw new Error(`Unknown argument: ${arg}`);
  }

  return {
    apply,
    reportPath
  };
}

async function run() {
  const options = parseArgs(process.argv.slice(2));
  const cognitoClient = createCognitoIdentityProviderClient();
  const users = await listCognitoUsers(cognitoClient);

  const report = [];
  for (const user of users) {
    const entry = await reconcileLegacyIdentity(user, options.apply);
    report.push(entry);
  }

  if (options.reportPath) {
    const outputPath = path.resolve(process.cwd(), options.reportPath);
    await writeFile(outputPath, JSON.stringify(report, null, 2) + "\n", "utf8");
  }

  const summary = report.reduce<Record<string, number>>((counts, entry) => {
    counts[entry.action] = (counts[entry.action] ?? 0) + 1;
    return counts;
  }, {});

  console.log(
    JSON.stringify(
      {
        apply: options.apply,
        totalUsers: users.length,
        summary
      },
      null,
      2
    )
  );
}

run()
  .catch((error: unknown) => {
    console.error("Cognito sync job failed.", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.close();
  });
