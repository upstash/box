const FIRST_DELAY_MS = 100;
const MAX_DELAY_MS = 2000;
const GROWTH = 1.5;

/** Wait before status check number `attempt` (0-based): short at first, growing to 2 seconds. */
export function pollDelay(attempt: number): number {
  return Math.min(MAX_DELAY_MS, Math.round(FIRST_DELAY_MS * GROWTH ** attempt));
}
