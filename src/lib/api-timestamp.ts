export type ApiTimestampInput = string | Date;

export function normalizeApiTimestamp(value: ApiTimestampInput | null): string | null {
  if (value === null) {
    return null;
  }

  const normalized = new Date(value);

  if (Number.isNaN(normalized.getTime())) {
    throw new Error(`Invalid API timestamp: ${String(value)}`);
  }

  return normalized.toISOString();
}
