import { describe, expect, it } from "vitest";

import { normalizeApiTimestamp } from "../src/lib/api-timestamp.js";

describe("normalizeApiTimestamp", () => {
  it("normalizes Postgres-style timestamp strings to canonical UTC ISO", () => {
    expect(normalizeApiTimestamp("2026-03-07 02:00:00-08:00")).toBe("2026-03-07T10:00:00.000Z");
  });

  it("passes through already normalized ISO strings", () => {
    expect(normalizeApiTimestamp("2026-03-07T10:00:00.000Z")).toBe("2026-03-07T10:00:00.000Z");
  });

  it("preserves null", () => {
    expect(normalizeApiTimestamp(null)).toBeNull();
  });

  it("throws for invalid timestamps", () => {
    expect(() => normalizeApiTimestamp("not-a-timestamp")).toThrow("Invalid API timestamp");
  });
});
