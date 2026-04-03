import { afterEach, describe, expect, it, vi } from "vitest";

const originalEnv = { ...process.env };

describe("env auth mode", () => {
  afterEach(() => {
    process.env = { ...originalEnv };
    vi.resetModules();
  });

  it("defaults to test_jwt outside production", async () => {
    process.env.NODE_ENV = "test";
    delete process.env.AUTH_MODE;

    const { env } = await import("../src/config/env.js");

    expect(env.AUTH_MODE).toBe("test_jwt");
  });

  it("defaults to cognito in production", async () => {
    process.env.NODE_ENV = "production";
    delete process.env.AUTH_MODE;

    const { env } = await import("../src/config/env.js");

    expect(env.AUTH_MODE).toBe("cognito");
  });

  it("rejects test_jwt in production", async () => {
    process.env.NODE_ENV = "production";
    process.env.AUTH_MODE = "test_jwt";

    await expect(import("../src/config/env.js")).rejects.toThrow(
      'AUTH_MODE must be "cognito" when NODE_ENV is "production".'
    );
  });
});
