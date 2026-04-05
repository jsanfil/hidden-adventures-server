import { describe, expect, it } from "vitest";

import {
  canonicalCategorySlugs,
  isCanonicalCategorySlug,
  normalizeAdventureCategorySlug
} from "../src/features/adventures/category-taxonomy.js";

describe("adventure category taxonomy", () => {
  it("exposes exactly the locked eight canonical category slugs", () => {
    expect(canonicalCategorySlugs).toEqual([
      "viewpoints",
      "trails",
      "water_spots",
      "food_drink",
      "abandoned_places",
      "caves",
      "nature_escapes",
      "roadside_stops"
    ]);
  });

  it("normalizes every supported legacy category to a canonical slug", () => {
    const cases: Array<[string, string]> = [
      ["Viewpoint", "viewpoints"],
      ["viewpoint", "viewpoints"],
      ["viewpoints", "viewpoints"],
      ["Trail", "trails"],
      ["trail", "trails"],
      ["trails", "trails"],
      ["Beach_Cove", "water_spots"],
      ["Creek_Rivers", "water_spots"],
      ["SwimmingHole", "water_spots"],
      ["RopeSwing", "water_spots"],
      ["Fishing", "water_spots"],
      ["beach-cove", "water_spots"],
      ["creek-river", "water_spots"],
      ["swimming-hole", "water_spots"],
      ["rope-swing", "water_spots"],
      ["fishing", "water_spots"],
      ["water_spots", "water_spots"],
      ["Restaurant", "food_drink"],
      ["Cafe", "food_drink"],
      ["Bar", "food_drink"],
      ["LiveMusic", "food_drink"],
      ["restaurant", "food_drink"],
      ["cafe", "food_drink"],
      ["bar", "food_drink"],
      ["live-music", "food_drink"],
      ["food_drink", "food_drink"],
      ["Abandoned", "abandoned_places"],
      ["abandoned", "abandoned_places"],
      ["abandoned_places", "abandoned_places"],
      ["Cave", "caves"],
      ["cave", "caves"],
      ["caves", "caves"],
      ["Forest", "nature_escapes"],
      ["Desert", "nature_escapes"],
      ["forest", "nature_escapes"],
      ["desert", "nature_escapes"],
      ["nature_escapes", "nature_escapes"],
      ["road", "roadside_stops"],
      ["Bridge", "roadside_stops"],
      ["roadside-stop", "roadside_stops"],
      ["bridge", "roadside_stops"],
      ["roadside_stops", "roadside_stops"]
    ];

    for (const [input, expected] of cases) {
      expect(normalizeAdventureCategorySlug(input)).toBe(expected);
    }
  });

  it("returns null for empty or unknown category inputs", () => {
    expect(normalizeAdventureCategorySlug(null)).toBeNull();
    expect(normalizeAdventureCategorySlug(undefined)).toBeNull();
    expect(normalizeAdventureCategorySlug("")).toBeNull();
    expect(normalizeAdventureCategorySlug("mystery")).toBeNull();
  });

  it("identifies canonical category slugs", () => {
    expect(isCanonicalCategorySlug("viewpoints")).toBe(true);
    expect(isCanonicalCategorySlug("roadside_stops")).toBe(true);
    expect(isCanonicalCategorySlug("viewpoint")).toBe(false);
    expect(isCanonicalCategorySlug("other")).toBe(false);
  });
});
