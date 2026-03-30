import type { AuthenticatedIdentity } from "./service.js";
import { getLocalIdentityFixture, LOCAL_IDENTITY_TOKEN_PREFIX } from "./local-fixtures.js";

export async function verifyLocalIdentityToken(token: string): Promise<AuthenticatedIdentity> {
  if (!token.startsWith(LOCAL_IDENTITY_TOKEN_PREFIX)) {
    throw new Error("Local identity tokens must use the local: prefix.");
  }

  const fixtureKey = token.slice(LOCAL_IDENTITY_TOKEN_PREFIX.length).trim();
  const fixture = getLocalIdentityFixture(fixtureKey);

  if (!fixture) {
    throw new Error(`Unknown local identity fixture "${fixtureKey}".`);
  }

  return fixture.identity;
}
