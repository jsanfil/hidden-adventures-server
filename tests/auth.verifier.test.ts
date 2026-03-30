import { afterEach, describe, expect, it, vi } from "vitest";

const { verifyCognitoTokenMock } = vi.hoisted(() => ({
  verifyCognitoTokenMock: vi.fn()
}));

vi.mock("../src/features/auth/cognito.js", () => ({
  verifyCognitoToken: verifyCognitoTokenMock
}));

describe("auth verifier", () => {
  afterEach(() => {
    verifyCognitoTokenMock.mockReset();
    vi.resetModules();
  });

  it("uses the Cognito verifier in cognito mode", async () => {
    verifyCognitoTokenMock.mockResolvedValue({
      sub: "sub-cognito",
      username: "cognito_user",
      email: "cognito@example.com",
      emailVerified: true,
      tokenUse: "id"
    });

    const { createIdentityVerifier } = await import("../src/features/auth/verifier.js");
    const verify = createIdentityVerifier("cognito");

    await expect(verify("opaque-cognito-token")).resolves.toEqual({
      sub: "sub-cognito",
      username: "cognito_user",
      email: "cognito@example.com",
      emailVerified: true,
      tokenUse: "id"
    });
    expect(verifyCognitoTokenMock).toHaveBeenCalledWith("opaque-cognito-token");
  });

  it("rejects invalid Cognito tokens", async () => {
    verifyCognitoTokenMock.mockRejectedValue(new Error("bad token"));

    const { createIdentityVerifier } = await import("../src/features/auth/verifier.js");
    const verify = createIdentityVerifier("cognito");

    await expect(verify("bad-token")).rejects.toThrow("bad token");
  });

  it("resolves stable local fixture identities", async () => {
    const { createIdentityVerifier } = await import("../src/features/auth/verifier.js");
    const verify = createIdentityVerifier("local_identity");

    await expect(verify("local:connected_viewer")).resolves.toEqual({
      sub: "local-sub-connected-viewer",
      username: "connected_viewer",
      email: "fixture.connected@hidden-adventures.local",
      emailVerified: true,
      tokenUse: "id"
    });
  });

  it("rejects invalid local fixture tokens", async () => {
    const { createIdentityVerifier } = await import("../src/features/auth/verifier.js");
    const verify = createIdentityVerifier("local_identity");

    await expect(verify("local:not_a_fixture")).rejects.toThrow('Unknown local identity fixture "not_a_fixture".');
    await expect(verify("opaque-token")).rejects.toThrow("Local identity tokens must use the local: prefix.");
  });
});
