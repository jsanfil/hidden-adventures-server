import type { PoolClient } from "pg";

import { db } from "../../db/client.js";
import {
  createRebuildUser,
  getLegacyUserByHandle,
  getUserByCognitoSubject,
  getUserByHandle,
  linkUserToCognitoSubject,
  listLegacyUsersByEmail,
  type LocalUser
} from "./repository.js";

export type AuthenticatedIdentity = {
  sub: string;
  username: string | null;
  email: string | null;
  emailVerified: boolean;
  tokenUse: "access" | "id";
};

export type AccountState =
  | "linked"
  | "legacy_claimed"
  | "new_user_needs_handle"
  | "manual_recovery_required";

export type BootstrapResult = {
  accountState: AccountState;
  user: LocalUser | null;
  suggestedHandle: string | null;
  recoveryEmail: string | null;
};

export type LegacySyncAction =
  | "already_linked_by_cognito_subject"
  | "linked_by_handle"
  | "linked_by_unique_email"
  | "manual_review_required"
  | "skipped_no_legacy_profile_match";

export type LegacySyncEntry = {
  action: LegacySyncAction;
  cognitoUsername: string | null;
  cognitoSub: string | null;
  email: string | null;
  matchedUserId: string | null;
  matchedHandle: string | null;
  reason: string;
};

export class HandleUnavailableError extends Error {
  constructor(handle: string) {
    super(`Handle "${handle}" is unavailable.`);
    this.name = "HandleUnavailableError";
  }
}

export class MissingAuthIdentityError extends Error {
  constructor() {
    super("Authenticated identity is required.");
    this.name = "MissingAuthIdentityError";
  }
}

function normalizeEmail(email: string | null | undefined): string | null {
  if (!email) {
    return null;
  }

  const normalized = email.trim().toLowerCase();
  return normalized.length > 0 ? normalized : null;
}

function normalizeHandle(handle: string): string {
  return handle.trim().toLowerCase();
}

function suggestHandle(identity: AuthenticatedIdentity): string | null {
  const candidates = [identity.username, identity.email?.split("@")[0] ?? null];

  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }

    const normalized = candidate.trim().toLowerCase().replace(/[^a-z0-9_]+/g, "_");
    const collapsed = normalized.replace(/^_+|_+$/g, "").replace(/_+/g, "_");
    if (collapsed.length >= 3) {
      return collapsed.slice(0, 64);
    }
  }

  return null;
}

function buildResult(
  accountState: AccountState,
  user: LocalUser | null,
  identity: AuthenticatedIdentity
): BootstrapResult {
  return {
    accountState,
    user,
    suggestedHandle: user ? null : suggestHandle(identity),
    recoveryEmail: identity.emailVerified ? normalizeEmail(identity.email) : null
  };
}

async function resolveLegacyMatch(
  identity: AuthenticatedIdentity,
  client?: PoolClient
): Promise<BootstrapResult | null> {
  if (identity.username) {
    const handleMatch = await getLegacyUserByHandle(identity.username, client);
    if (handleMatch) {
      if (handleMatch.cognitoSubject && handleMatch.cognitoSubject !== identity.sub) {
        return buildResult("manual_recovery_required", handleMatch, identity);
      }

      const linked = await linkUserToCognitoSubject(
        handleMatch.id,
        identity.sub,
        normalizeEmail(identity.email),
        client
      );

      return buildResult("legacy_claimed", linked ?? handleMatch, identity);
    }
  }

  const normalizedEmail = identity.emailVerified ? normalizeEmail(identity.email) : null;
  if (!normalizedEmail) {
    return null;
  }

  const emailMatches = await listLegacyUsersByEmail(normalizedEmail, client);
  if (emailMatches.length > 1) {
    return buildResult("manual_recovery_required", null, identity);
  }

  const emailMatch = emailMatches[0];
  if (!emailMatch) {
    return null;
  }

  if (emailMatch.cognitoSubject && emailMatch.cognitoSubject !== identity.sub) {
    return buildResult("manual_recovery_required", emailMatch, identity);
  }

  const linked = await linkUserToCognitoSubject(emailMatch.id, identity.sub, normalizedEmail, client);
  return buildResult("legacy_claimed", linked ?? emailMatch, identity);
}

export async function bootstrapAuthenticatedIdentity(
  identity: AuthenticatedIdentity
): Promise<BootstrapResult> {
  if (!identity.sub) {
    throw new MissingAuthIdentityError();
  }

  return db.withTransaction(async (client) => {
    const existing = await getUserByCognitoSubject(identity.sub, client);
    if (existing) {
      return buildResult("linked", existing, identity);
    }

    const legacyMatch = await resolveLegacyMatch(identity, client);
    if (legacyMatch) {
      return legacyMatch;
    }

    return buildResult("new_user_needs_handle", null, identity);
  });
}

export async function completeHandleSelection(
  identity: AuthenticatedIdentity,
  handle: string
): Promise<BootstrapResult> {
  if (!identity.sub) {
    throw new MissingAuthIdentityError();
  }

  const normalizedHandle = normalizeHandle(handle);

  return db.withTransaction(async (client) => {
    const existing = await getUserByCognitoSubject(identity.sub, client);
    if (existing) {
      return buildResult("linked", existing, identity);
    }

    const legacyMatch = await resolveLegacyMatch(identity, client);
    if (legacyMatch) {
      return legacyMatch;
    }

    const conflictingUser = await getUserByHandle(normalizedHandle, client);
    if (conflictingUser) {
      throw new HandleUnavailableError(normalizedHandle);
    }

    const created = await createRebuildUser(
      {
        cognitoSubject: identity.sub,
        handle: normalizedHandle,
        email: identity.emailVerified ? normalizeEmail(identity.email) : null
      },
      client
    );

    return buildResult("linked", created, identity);
  });
}

async function buildLegacySyncEntry(
  identity: AuthenticatedIdentity,
  client?: PoolClient
): Promise<LegacySyncEntry> {
  const normalizedEmail = identity.emailVerified ? normalizeEmail(identity.email) : null;

  const existing = await getUserByCognitoSubject(identity.sub, client);
  if (existing) {
    if (existing.accountOrigin !== "legacy_profile_import") {
      return {
        action: "skipped_no_legacy_profile_match",
        cognitoUsername: identity.username,
        cognitoSub: identity.sub,
        email: normalizedEmail,
        matchedUserId: existing.id,
        matchedHandle: existing.handle,
        reason: "Cognito subject is already linked to a rebuild signup, not a legacy profile import."
      };
    }

    return {
      action: "already_linked_by_cognito_subject",
      cognitoUsername: identity.username,
      cognitoSub: identity.sub,
      email: normalizedEmail,
      matchedUserId: existing.id,
      matchedHandle: existing.handle,
      reason: "Cognito subject already maps to a legacy-profile-backed user."
    };
  }

  if (identity.username) {
    const handleMatch = await getLegacyUserByHandle(identity.username, client);
    if (handleMatch) {
      if (handleMatch.cognitoSubject && handleMatch.cognitoSubject !== identity.sub) {
        return {
          action: "manual_review_required",
          cognitoUsername: identity.username,
          cognitoSub: identity.sub,
          email: normalizedEmail,
          matchedUserId: handleMatch.id,
          matchedHandle: handleMatch.handle,
          reason: "Legacy handle already links to a different Cognito subject."
        };
      }

      return {
        action: "linked_by_handle",
        cognitoUsername: identity.username,
        cognitoSub: identity.sub,
        email: normalizedEmail,
        matchedUserId: handleMatch.id,
        matchedHandle: handleMatch.handle,
        reason: "Matched a legacy-profile-backed user by exact handle."
      };
    }
  }

  if (normalizedEmail) {
    const emailMatches = await listLegacyUsersByEmail(normalizedEmail, client);
    if (emailMatches.length === 1) {
      const emailMatch = emailMatches[0];
      if (emailMatch.cognitoSubject && emailMatch.cognitoSubject !== identity.sub) {
        return {
          action: "manual_review_required",
          cognitoUsername: identity.username,
          cognitoSub: identity.sub,
          email: normalizedEmail,
          matchedUserId: emailMatch.id,
          matchedHandle: emailMatch.handle,
          reason: "Legacy email match is already linked to a different Cognito subject."
        };
      }

      return {
        action: "linked_by_unique_email",
        cognitoUsername: identity.username,
        cognitoSub: identity.sub,
        email: normalizedEmail,
        matchedUserId: emailMatch.id,
        matchedHandle: emailMatch.handle,
        reason: "Matched a legacy-profile-backed user by unique email."
      };
    }

    if (emailMatches.length > 1) {
      return {
        action: "manual_review_required",
        cognitoUsername: identity.username,
        cognitoSub: identity.sub,
        email: normalizedEmail,
        matchedUserId: null,
        matchedHandle: null,
        reason: "Verified email matched multiple legacy-profile-backed users."
      };
    }
  }

  return {
    action: "skipped_no_legacy_profile_match",
    cognitoUsername: identity.username,
    cognitoSub: identity.sub,
    email: normalizedEmail,
    matchedUserId: null,
    matchedHandle: null,
    reason: "No legacy-profile-backed user matched by subject, handle, or unique email."
  };
}

export async function reconcileLegacyIdentity(
  identity: AuthenticatedIdentity,
  apply: boolean
): Promise<LegacySyncEntry> {
  return db.withTransaction(async (client) => {
    const entry = await buildLegacySyncEntry(identity, client);

    if (
      apply &&
      entry.cognitoSub &&
      entry.matchedUserId &&
      (entry.action === "linked_by_handle" || entry.action === "linked_by_unique_email")
    ) {
      await linkUserToCognitoSubject(entry.matchedUserId, entry.cognitoSub, entry.email, client);
    }

    return entry;
  });
}
