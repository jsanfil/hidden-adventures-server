export type ApiAdventureVisibility = "private" | "sidekicks" | "public";
export type StoredAdventureVisibility = "private" | "connections" | "public";

export function toApiAdventureVisibility(value: string): string {
  return value === "connections" ? "sidekicks" : value;
}

export function toStoredAdventureVisibility(
  value: ApiAdventureVisibility
): StoredAdventureVisibility {
  return value === "sidekicks" ? "connections" : value;
}
