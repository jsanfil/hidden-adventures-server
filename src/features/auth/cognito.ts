import {
  CognitoIdentityProviderClient,
  ListUsersCommand,
  type AttributeType,
  type ListUsersCommandOutput,
  type UserType
} from "@aws-sdk/client-cognito-identity-provider";
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";

import { env } from "../../config/env.js";
import type { AuthenticatedIdentity } from "./service.js";

export type CognitoDirectoryUser = AuthenticatedIdentity;

const jwksByIssuer = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

export class CognitoConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CognitoConfigurationError";
  }
}

function getConfiguredPoolId(): string {
  if (!env.COGNITO_USER_POOL_ID) {
    throw new CognitoConfigurationError("COGNITO_USER_POOL_ID is required for Cognito auth.");
  }

  return env.COGNITO_USER_POOL_ID;
}

function getConfiguredClientId(): string {
  if (!env.COGNITO_CLIENT_ID) {
    throw new CognitoConfigurationError("COGNITO_CLIENT_ID is required for Cognito auth.");
  }

  return env.COGNITO_CLIENT_ID;
}

function getIssuer(): string {
  return `https://cognito-idp.${env.AWS_REGION}.amazonaws.com/${getConfiguredPoolId()}`;
}

function getJwks(issuer: string) {
  const cached = jwksByIssuer.get(issuer);
  if (cached) {
    return cached;
  }

  const jwks = createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`));
  jwksByIssuer.set(issuer, jwks);
  return jwks;
}

function getAttribute(attributes: AttributeType[] | undefined, name: string): string | null {
  const value = attributes?.find((attribute) => attribute.Name === name)?.Value;
  return value?.trim() || null;
}

function parseEmailVerified(value: string | null | undefined): boolean {
  return value === "true";
}

function parseIdentityFromPayload(payload: JWTPayload): AuthenticatedIdentity {
  const sub = payload.sub;
  if (typeof sub !== "string" || sub.length === 0) {
    throw new CognitoConfigurationError("Cognito token is missing the subject claim.");
  }

  const tokenUse = payload.token_use;
  if (tokenUse !== "id" && tokenUse !== "access") {
    throw new CognitoConfigurationError("Unsupported Cognito token_use.");
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

export async function verifyCognitoToken(token: string): Promise<AuthenticatedIdentity> {
  const issuer = getIssuer();
  const clientId = getConfiguredClientId();
  const { payload } = await jwtVerify(token, getJwks(issuer), {
    issuer
  });

  const identity = parseIdentityFromPayload(payload);
  if (identity.tokenUse === "id") {
    if (payload.aud !== clientId) {
      throw new CognitoConfigurationError("Cognito ID token audience did not match the configured client.");
    }
  } else if (payload.client_id !== clientId) {
    throw new CognitoConfigurationError(
      "Cognito access token client_id did not match the configured client."
    );
  }

  return identity;
}

export function createCognitoIdentityProviderClient(): CognitoIdentityProviderClient {
  return new CognitoIdentityProviderClient({
    region: env.AWS_REGION
  });
}

function mapDirectoryUser(user: UserType): CognitoDirectoryUser | null {
  const sub = getAttribute(user.Attributes, "sub");
  if (!sub) {
    return null;
  }

  return {
    sub,
    username: user.Username?.trim() || null,
    email: getAttribute(user.Attributes, "email"),
    emailVerified: parseEmailVerified(getAttribute(user.Attributes, "email_verified")),
    tokenUse: "id"
  };
}

export async function listCognitoUsers(
  client = createCognitoIdentityProviderClient()
): Promise<CognitoDirectoryUser[]> {
  const users: CognitoDirectoryUser[] = [];
  let paginationToken: string | undefined;

  do {
    const response = await client.send(
      new ListUsersCommand({
        UserPoolId: getConfiguredPoolId(),
        PaginationToken: paginationToken
      })
    ) as ListUsersCommandOutput;

    for (const user of response.Users ?? []) {
      const mapped = mapDirectoryUser(user);
      if (mapped) {
        users.push(mapped);
      }
    }

    paginationToken = response.PaginationToken;
  } while (paginationToken);

  return users;
}
