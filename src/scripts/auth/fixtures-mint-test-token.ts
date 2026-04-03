import { createPrivateKey } from "node:crypto";
import { readFile } from "node:fs/promises";

import { importPKCS8, SignJWT } from "jose";

import { env } from "../../config/env.js";
import { loadFixturePack } from "../../features/fixtures/manifest.js";

type CliOptions = {
  pack: string;
  persona: string;
};

function parseArgs(argv: string[]): CliOptions {
  let pack = "test-core";
  let persona: string | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--pack") {
      pack = argv[index + 1] ?? pack;
      index += 1;
      continue;
    }

    if (arg === "--persona") {
      persona = argv[index + 1];
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!persona) {
    throw new Error("Missing required --persona <key> argument.");
  }

  return { pack, persona };
}

async function loadPrivateKeyPem(): Promise<string> {
  if (env.TEST_JWT_PRIVATE_KEY) {
    return env.TEST_JWT_PRIVATE_KEY;
  }

  if (env.TEST_JWT_PRIVATE_KEY_FILE) {
    return readFile(env.TEST_JWT_PRIVATE_KEY_FILE, "utf8");
  }

  throw new Error("TEST_JWT_PRIVATE_KEY or TEST_JWT_PRIVATE_KEY_FILE is required to mint tokens.");
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const pack = await loadFixturePack(options.pack);
  const persona = pack.personas.find((entry) => entry.key === options.persona);

  if (!persona) {
    throw new Error(`Unknown fixture persona "${options.persona}".`);
  }

  if (persona.authMode !== "test_jwt" || !persona.testJwtSub) {
    throw new Error(`Fixture persona "${persona.key}" does not support test_jwt token minting.`);
  }

  if (!env.TEST_JWT_ISSUER || !env.TEST_JWT_AUDIENCE) {
    throw new Error("TEST_JWT_ISSUER and TEST_JWT_AUDIENCE are required to mint test tokens.");
  }

  const privateKeyPem = await loadPrivateKeyPem();
  const privateKey = createPrivateKey(privateKeyPem).export({ format: "pem", type: "pkcs8" }).toString();
  const signingKey = await importPKCS8(privateKey, "RS256");

  const token = await new SignJWT({
    "cognito:username": persona.username,
    email: persona.email,
    email_verified: persona.emailVerified,
    token_use: "id",
    username: persona.username
  })
    .setProtectedHeader({ alg: "RS256", typ: "JWT" })
    .setIssuedAt()
    .setIssuer(env.TEST_JWT_ISSUER)
    .setAudience(env.TEST_JWT_AUDIENCE)
    .setSubject(persona.testJwtSub)
    .setExpirationTime("12h")
    .sign(signingKey);

  console.log(token);
}

void main().catch((error: unknown) => {
  console.error("Test token minting failed.", error);
  process.exitCode = 1;
});
