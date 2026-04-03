import {
  AdminCreateUserCommand,
  AdminGetUserCommand,
  AdminSetUserPasswordCommand,
  AdminUpdateUserAttributesCommand
} from "@aws-sdk/client-cognito-identity-provider";

import { env } from "../config/env.js";
import { createCognitoIdentityProviderClient } from "../features/auth/cognito.js";
import { loadFixturePack } from "../features/fixtures/manifest.js";

type CliOptions = {
  pack: string;
};

function parseArgs(argv: string[]): CliOptions {
  let pack = "qa-rich";

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--pack") {
      pack = argv[index + 1] ?? pack;
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return { pack };
}

async function main() {
  if (!env.COGNITO_USER_POOL_ID) {
    throw new Error("COGNITO_USER_POOL_ID is required for fixture Cognito provisioning.");
  }

  if (!env.FIXTURE_COGNITO_PASSWORD) {
    throw new Error("FIXTURE_COGNITO_PASSWORD is required for fixture Cognito provisioning.");
  }

  const options = parseArgs(process.argv.slice(2));
  const pack = await loadFixturePack(options.pack);
  const client = createCognitoIdentityProviderClient();
  const summary = {
    created: 0,
    updated: 0
  };

  for (const persona of pack.personas.filter((entry) => entry.authMode === "cognito")) {
    let exists = true;

    try {
      await client.send(
        new AdminGetUserCommand({
          UserPoolId: env.COGNITO_USER_POOL_ID,
          Username: persona.username
        })
      );
    } catch {
      exists = false;
    }

    if (!exists) {
      await client.send(
        new AdminCreateUserCommand({
          UserPoolId: env.COGNITO_USER_POOL_ID,
          Username: persona.username,
          MessageAction: "SUPPRESS",
          UserAttributes: [
            { Name: "email", Value: persona.email },
            { Name: "email_verified", Value: persona.emailVerified ? "true" : "false" }
          ]
        })
      );
      summary.created += 1;
    } else {
      await client.send(
        new AdminUpdateUserAttributesCommand({
          UserPoolId: env.COGNITO_USER_POOL_ID,
          Username: persona.username,
          UserAttributes: [
            { Name: "email", Value: persona.email },
            { Name: "email_verified", Value: persona.emailVerified ? "true" : "false" }
          ]
        })
      );
      summary.updated += 1;
    }

    await client.send(
      new AdminSetUserPasswordCommand({
        UserPoolId: env.COGNITO_USER_POOL_ID,
        Username: persona.username,
        Password: env.FIXTURE_COGNITO_PASSWORD,
        Permanent: true
      })
    );
  }

  console.log(
    JSON.stringify(
      {
        pack: pack.pack,
        userPoolId: env.COGNITO_USER_POOL_ID,
        summary
      },
      null,
      2
    )
  );
}

void main().catch((error: unknown) => {
  console.error("Fixture Cognito provisioning failed.", error);
  process.exitCode = 1;
});
