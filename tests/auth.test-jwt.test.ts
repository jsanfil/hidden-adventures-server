import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("test jwt verifier", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      AUTH_MODE: "test_jwt",
      TEST_JWT_ISSUER: "http://local.hidden-adventures.test",
      TEST_JWT_AUDIENCE: "hidden-adventures-local",
      TEST_JWT_PUBLIC_KEY_FILE: "fixtures/keys/test-jwt-public.pem",
      TEST_JWT_PRIVATE_KEY_FILE: "fixtures/keys/test-jwt-private.pem"
    };
    vi.resetModules();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.resetModules();
  });

  it("mints and verifies a deterministic test token", async () => {
    const { loadFixturePack } = await import("../src/features/fixtures/manifest.js");
    const { verifyTestJwtToken } = await import("../src/features/auth/test-jwt.js");
    const { SignJWT, importPKCS8 } = await import("jose");
    const { readFile } = await import("node:fs/promises");

    const pack = await loadFixturePack("test-core");
    const persona = pack.personas.find((entry) => entry.key === "connected_viewer");
    const privateKeyPem = await readFile("fixtures/keys/test-jwt-private.pem", "utf8");
    const signingKey = await importPKCS8(privateKeyPem, "RS256");

    const token = await new SignJWT({
      "cognito:username": persona?.username,
      email: persona?.email,
      email_verified: true,
      token_use: "id",
      username: persona?.username
    })
      .setProtectedHeader({ alg: "RS256", typ: "JWT" })
      .setIssuer("http://local.hidden-adventures.test")
      .setAudience("hidden-adventures-local")
      .setSubject(persona?.testJwtSub ?? "")
      .setIssuedAt()
      .setExpirationTime("10m")
      .sign(signingKey);

    await expect(verifyTestJwtToken(token)).resolves.toEqual({
      sub: "test-sub-connected-viewer",
      username: "connected_viewer",
      email: "fixture.connected@hidden-adventures.local",
      emailVerified: true,
      tokenUse: "id"
    });
  });
});
