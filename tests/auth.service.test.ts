import { beforeEach, describe, expect, it, vi } from "vitest";

const { dbMock } = vi.hoisted(() => ({
  dbMock: {
    query: vi.fn(),
    withTransaction: vi.fn()
  }
}));

vi.mock("../src/db/client.js", () => ({
  db: dbMock
}));

import {
  bootstrapAuthenticatedIdentity,
  completeHandleSelection,
  reconcileLegacyIdentity
} from "../src/features/auth/service.js";

describe("auth service", () => {
  beforeEach(() => {
    dbMock.query.mockReset();
    dbMock.withTransaction.mockReset();
    dbMock.withTransaction.mockImplementation(async (callback) => callback({ query: dbMock.query }));
  });

  it("claims a legacy-profile-backed user by unique verified email", async () => {
    dbMock.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          {
            id: "legacy-user-1",
            cognito_subject: null,
            handle: "oldtrailfan",
            email: "legacy@example.com",
            account_origin: "legacy_profile_import",
            status: "active",
            created_at: "2018-01-01T00:00:00.000Z",
            updated_at: "2026-03-01T00:00:00.000Z"
          }
        ]
      })
      .mockResolvedValueOnce({
        rows: [
          {
            id: "legacy-user-1",
            cognito_subject: "sub-1",
            handle: "oldtrailfan",
            email: "legacy@example.com",
            account_origin: "legacy_profile_import",
            status: "active",
            created_at: "2018-01-01T00:00:00.000Z",
            updated_at: "2026-03-02T00:00:00.000Z"
          }
        ]
      });

    const result = await bootstrapAuthenticatedIdentity({
      sub: "sub-1",
      username: null,
      email: "legacy@example.com",
      emailVerified: true,
      tokenUse: "id"
    });

    expect(result).toEqual({
      accountState: "legacy_claimed",
      user: {
        id: "legacy-user-1",
        cognitoSubject: "sub-1",
        handle: "oldtrailfan",
        email: "legacy@example.com",
        accountOrigin: "legacy_profile_import",
        status: "active",
        createdAt: "2018-01-01T00:00:00.000Z",
        updatedAt: "2026-03-02T00:00:00.000Z"
      },
      suggestedHandle: null,
      recoveryEmail: "legacy@example.com"
    });
  });

  it("returns an already linked user by cognito subject before any handle matching", async () => {
    dbMock.query.mockResolvedValueOnce({
      rows: [
        {
          id: "linked-user-1",
          cognito_subject: "sub-linked",
          handle: "jacksanfil",
          email: "jack@example.com",
          account_origin: "legacy_profile_import",
          status: "active",
          created_at: "2018-01-01T00:00:00.000Z",
          updated_at: "2026-03-01T00:00:00.000Z"
        }
      ]
    });

    const result = await bootstrapAuthenticatedIdentity({
      sub: "sub-linked",
      username: "ignoredlegacyname",
      email: "jack@example.com",
      emailVerified: true,
      tokenUse: "id"
    });

    expect(result).toEqual({
      accountState: "linked",
      user: {
        id: "linked-user-1",
        cognitoSubject: "sub-linked",
        handle: "jacksanfil",
        email: "jack@example.com",
        accountOrigin: "legacy_profile_import",
        status: "active",
        createdAt: "2018-01-01T00:00:00.000Z",
        updatedAt: "2026-03-01T00:00:00.000Z"
      },
      suggestedHandle: null,
      recoveryEmail: "jack@example.com"
    });
  });

  it("claims a legacy-profile-backed user by exact cognito username matching users.handle", async () => {
    dbMock.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          {
            id: "legacy-user-2",
            cognito_subject: null,
            handle: "oldtrailfan",
            email: "legacy@example.com",
            account_origin: "legacy_profile_import",
            status: "active",
            created_at: "2018-01-01T00:00:00.000Z",
            updated_at: "2026-03-01T00:00:00.000Z"
          }
        ]
      })
      .mockResolvedValueOnce({
        rows: [
          {
            id: "legacy-user-2",
            cognito_subject: "sub-handle",
            handle: "oldtrailfan",
            email: "legacy@example.com",
            account_origin: "legacy_profile_import",
            status: "active",
            created_at: "2018-01-01T00:00:00.000Z",
            updated_at: "2026-03-02T00:00:00.000Z"
          }
        ]
      });

    const result = await bootstrapAuthenticatedIdentity({
      sub: "sub-handle",
      username: "oldtrailfan",
      email: "legacy@example.com",
      emailVerified: true,
      tokenUse: "id"
    });

    expect(result).toEqual({
      accountState: "legacy_claimed",
      user: {
        id: "legacy-user-2",
        cognitoSubject: "sub-handle",
        handle: "oldtrailfan",
        email: "legacy@example.com",
        accountOrigin: "legacy_profile_import",
        status: "active",
        createdAt: "2018-01-01T00:00:00.000Z",
        updatedAt: "2026-03-02T00:00:00.000Z"
      },
      suggestedHandle: null,
      recoveryEmail: "legacy@example.com"
    });
  });

  it("returns new_user_needs_handle when there is no legacy-backed match", async () => {
    dbMock.query.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [] });

    const result = await bootstrapAuthenticatedIdentity({
      sub: "sub-2",
      username: null,
      email: "fresh@example.com",
      emailVerified: true,
      tokenUse: "id"
    });

    expect(result).toEqual({
      accountState: "new_user_needs_handle",
      user: null,
      suggestedHandle: "fresh",
      recoveryEmail: "fresh@example.com"
    });
  });

  it("prefers the email local part over the Cognito username for suggested handles", async () => {
    dbMock.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const result = await bootstrapAuthenticatedIdentity({
      sub: "sub-2",
      username: "fresh_user_abcd1234abcd1234abcd1234",
      email: "fresh.person+qa@example.com",
      emailVerified: true,
      tokenUse: "id"
    });

    expect(result).toEqual({
      accountState: "new_user_needs_handle",
      user: null,
      suggestedHandle: "fresh_person_qa",
      recoveryEmail: "fresh.person+qa@example.com"
    });
  });

  it("creates a rebuild user with a normalized public handle", async () => {
    dbMock.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          {
            id: "new-user-1",
            cognito_subject: "sub-new",
            handle: "new_user",
            email: "fresh@example.com",
            account_origin: "rebuild_signup",
            status: "active",
            created_at: "2026-03-01T00:00:00.000Z",
            updated_at: "2026-03-01T00:00:00.000Z"
          }
        ]
      });

    const result = await completeHandleSelection(
      {
        sub: "sub-new",
        username: "FreshUser",
        email: "fresh@example.com",
        emailVerified: true,
        tokenUse: "id"
      },
      " New_User "
    );

    expect(result).toEqual({
      accountState: "linked",
      user: {
        id: "new-user-1",
        cognitoSubject: "sub-new",
        handle: "new_user",
        email: "fresh@example.com",
        accountOrigin: "rebuild_signup",
        status: "active",
        createdAt: "2026-03-01T00:00:00.000Z",
        updatedAt: "2026-03-01T00:00:00.000Z"
      },
      suggestedHandle: null,
      recoveryEmail: "fresh@example.com"
    });
    expect(dbMock.query).toHaveBeenNthCalledWith(4, expect.any(String), ["new_user"]);
  });

  it("skips Cognito users that do not map to a legacy-profile-backed account", async () => {
    dbMock.query.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [] });

    const result = await reconcileLegacyIdentity(
      {
        sub: "sub-3",
        username: null,
        email: "abandoned@example.com",
        emailVerified: true,
        tokenUse: "id"
      },
      false
    );

    expect(result).toEqual({
      action: "skipped_no_legacy_profile_match",
      cognitoUsername: null,
      cognitoSub: "sub-3",
      email: "abandoned@example.com",
      matchedUserId: null,
      matchedHandle: null,
      reason: "No legacy-profile-backed user matched by subject or exact handle."
    });
  });

  it("ignores competing Cognito duplicates when a legacy handle is already linked", async () => {
    dbMock.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          {
            id: "legacy-user-3",
            cognito_subject: "approved-sub",
            handle: "oldtrailfan",
            email: "legacy@example.com",
            account_origin: "legacy_profile_import",
            status: "active",
            created_at: "2018-01-01T00:00:00.000Z",
            updated_at: "2026-03-01T00:00:00.000Z"
          }
        ]
      });

    const result = await reconcileLegacyIdentity(
      {
        sub: "competing-sub",
        username: "oldtrailfan",
        email: null,
        emailVerified: false,
        tokenUse: "id"
      },
      false
    );

    expect(result).toEqual({
      action: "ignored_competing_cognito_duplicate",
      cognitoUsername: "oldtrailfan",
      cognitoSub: "competing-sub",
      email: null,
      matchedUserId: "legacy-user-3",
      matchedHandle: "oldtrailfan",
      reason:
        "Legacy handle is already linked to a different Cognito subject; ignore this competing Cognito account for migration."
    });
  });

  it("does not auto-link bulk sync users by email when the handle does not match", async () => {
    dbMock.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const result = await reconcileLegacyIdentity(
      {
        sub: "competing-sub-email",
        username: null,
        email: "legacy@example.com",
        emailVerified: true,
        tokenUse: "id"
      },
      false
    );

    expect(result).toEqual({
      action: "skipped_no_legacy_profile_match",
      cognitoUsername: null,
      cognitoSub: "competing-sub-email",
      email: "legacy@example.com",
      matchedUserId: null,
      matchedHandle: null,
      reason: "No legacy-profile-backed user matched by subject or exact handle."
    });
  });
});
