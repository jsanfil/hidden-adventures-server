import { createPublicKey } from "node:crypto";
import { readFile } from "node:fs/promises";

import { importSPKI, jwtVerify, type JWTPayload } from "jose";

import { env } from "../../config/env.js";
import type { AuthenticatedIdentity } from "./service.js";

type VerifierKey = Awaited<ReturnType<typeof importSPKI>>;

const keyCache = new Map<string, Promise<VerifierKey>>();

function resolvePublicKeySource(): string {
  if (env.TEST_JWT_PUBLIC_KEY) {
    return env.TEST_JWT_PUBLIC_KEY;
  }

  if (env.TEST_JWT_PUBLIC_KEY_FILE) {
    return env.TEST_JWT_PUBLIC_KEY_FILE;
  }

  throw new Error("TEST_JWT_PUBLIC_KEY or TEST_JWT_PUBLIC_KEY_FILE is required for test_jwt auth.");
}

async function loadPublicKey(): Promise<string> {
  if (env.TEST_JWT_PUBLIC_KEY) {
    return env.TEST_JWT_PUBLIC_KEY;
  }

  if (!env.TEST_JWT_PUBLIC_KEY_FILE) {
    throw new Error("TEST_JWT_PUBLIC_KEY_FILE is required when TEST_JWT_PUBLIC_KEY is unset.");
  }

  return readFile(env.TEST_JWT_PUBLIC_KEY_FILE, "utf8");
}

async function getVerifierKey(): Promise<VerifierKey> {
  const source = resolvePublicKeySource();
  const cached = keyCache.get(source);

  if (cached) {
    return cached;
  }

  const keyPromise = loadPublicKey().then(async (pem) => {
    const publicKey = createPublicKey(pem).export({ type: "spki", format: "pem" }).toString();
    return importSPKI(publicKey, "RS256");
  });

  keyCache.set(source, keyPromise);
  return keyPromise;
}

function parseIdentity(payload: JWTPayload): AuthenticatedIdentity {
  const sub = typeof payload.sub === "string" ? payload.sub : null;
  if (!sub) {
    throw new Error("Test JWT token is missing the subject claim.");
  }

  const tokenUse = payload.token_use;
  if (tokenUse !== "id" && tokenUse !== "access") {
    throw new Error("Unsupported test JWT token_use.");
  }

  return {
    sub,
    username:
      typeof payload["cognito:username"] === "string"
        ? payload["cognito:username"]
        : typeof payload.username === "string"
          ? payload.username
          : null,
    email: typeof payload.email === "string" ? payload.email : null,
    emailVerified: payload.email_verified === true || payload.email_verified === "true",
    tokenUse
  };
}

export async function verifyTestJwtToken(token: string): Promise<AuthenticatedIdentity> {
  const { payload } = await jwtVerify(token, await getVerifierKey(), {
    issuer: env.TEST_JWT_ISSUER,
    audience: env.TEST_JWT_AUDIENCE
  });

  return parseIdentity(payload);
}
