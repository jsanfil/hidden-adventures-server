import { afterEach, describe, expect, it, vi } from "vitest";

const originalEnv = { ...process.env };

describe("env auth mode", () => {
  afterEach(() => {
    process.env = { ...originalEnv };
    vi.resetModules();
  });

  it("defaults to local_identity outside production", async () => {
    process.env.NODE_ENV = "test";
    delete process.env.AUTH_MODE;

    const { env } = await import("../src/config/env.js");

    expect(env.AUTH_MODE).toBe("local_identity");
  });

  it("defaults to cognito in production", async () => {
    process.env.NODE_ENV = "production";
    delete process.env.AUTH_MODE;

    const { env } = await import("../src/config/env.js");

    expect(env.AUTH_MODE).toBe("cognito");
  });

  it("rejects local_identity in production", async () => {
    process.env.NODE_ENV = "production";
    process.env.AUTH_MODE = "local_identity";

    await expect(import("../src/config/env.js")).rejects.toThrow(
      'AUTH_MODE must be "cognito" when NODE_ENV is "production".'
    );
  });
});
