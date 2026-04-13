export type ApiAdventureVisibility = "private" | "sidekicks" | "public";
export type StoredAdventureVisibility = ApiAdventureVisibility;

export function toApiAdventureVisibility(value: string): string {
  return value;
}

export function toStoredAdventureVisibility(
  value: ApiAdventureVisibility
): StoredAdventureVisibility {
  return value;
}
