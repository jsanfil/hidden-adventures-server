import { describe, expect, it } from "vitest";

import {
  excludedLegacyProfileHandles,
  excludedLegacyProfileReason,
  shouldExcludeLegacyProfileHandle
} from "../src/scripts/lib/legacy-profile-exclusions.js";

describe("legacy profile exclusions", () => {
  it("tracks the historically-approved 29 zero-activity duplicate legacy profiles", () => {
    expect(excludedLegacyProfileHandles).toEqual([
      ".",
      "Atlas",
      "Fasholy",
      "Miko",
      "atlas",
      "claire.a",
      "claire_abbott",
      "cutie",
      "flannelpants12",
      "g",
      "jackelyng007",
      "jackieg13",
      "jagonza14",
      "jannika.johnson",
      "kateellis",
      "kateellislogsdon",
      "katee-l",
      "krivsophie",
      "lucia",
      "miko",
      "riley-contreras",
      "rileyshae11",
      "sophiekriv",
      "sophiexkriv",
      "tom420",
      "ttgocrazy",
      "ttgokraazy",
      "vandaad",
      "vk"
    ]);
    expect(excludedLegacyProfileHandles).toHaveLength(29);
  });

  it("matches only the explicit exclusion set", () => {
    expect(shouldExcludeLegacyProfileHandle("atlas")).toBe(true);
    expect(shouldExcludeLegacyProfileHandle("Atlas")).toBe(true);
    expect(shouldExcludeLegacyProfileHandle("jackieg13")).toBe(true);
    expect(shouldExcludeLegacyProfileHandle("kateellis")).toBe(true);
    expect(shouldExcludeLegacyProfileHandle("viewpoints")).toBe(false);
    expect(shouldExcludeLegacyProfileHandle("fixture_author")).toBe(false);
    expect(shouldExcludeLegacyProfileHandle(null)).toBe(false);
    expect(shouldExcludeLegacyProfileHandle(undefined)).toBe(false);
  });

  it("keeps the exclusion reason stable for import auditing", () => {
    expect(excludedLegacyProfileReason).toBe(
      "Zero-activity duplicate legacy profile intentionally excluded from the rebuild dataset."
    );
  });
});
