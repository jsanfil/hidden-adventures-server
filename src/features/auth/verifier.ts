import { env, type AuthMode } from "../../config/env.js";
import { verifyCognitoToken } from "./cognito.js";
import { verifyLocalIdentityToken } from "./local-identity.js";
import type { AuthenticatedIdentity } from "./service.js";

export type IdentityVerifier = (token: string) => Promise<AuthenticatedIdentity>;

export function createIdentityVerifier(mode: AuthMode = env.AUTH_MODE): IdentityVerifier {
  if (mode === "cognito") {
    return verifyCognitoToken;
  }

  return verifyLocalIdentityToken;
}
