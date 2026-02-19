/**
 * Format data as JSON for display.
 */
export function formatJSON(data: unknown): string {
  return JSON.stringify(data, null, 2);
}

/**
 * Format raw text for display.
 */
export function formatRaw(text: string): string {
  return text;
}
