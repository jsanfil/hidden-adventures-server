const excludedLegacyProfileHandles = [
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
] as const;

export const excludedLegacyProfileHandleSet = new Set<string>(excludedLegacyProfileHandles);

export const excludedLegacyProfileReason =
  "Zero-activity duplicate legacy profile intentionally excluded from the rebuild dataset.";

export function shouldExcludeLegacyProfileHandle(handle: string | null | undefined): boolean {
  if (!handle) {
    return false;
  }

  return excludedLegacyProfileHandleSet.has(handle);
}

export { excludedLegacyProfileHandles };
