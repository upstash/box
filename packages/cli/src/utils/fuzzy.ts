/**
 * Levenshtein edit distance between two strings.
 */
export function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0) as number[]);

  for (let i = 0; i <= m; i++) dp[i]![0] = i;
  for (let j = 0; j <= n; j++) dp[0]![j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i]![j] = Math.min(dp[i - 1]![j]! + 1, dp[i]![j - 1]! + 1, dp[i - 1]![j - 1]! + cost);
    }
  }

  return dp[m]![n]!;
}

/**
 * Return candidates sorted by edit distance, filtered to maxDistance.
 */
export function fuzzyMatch(input: string, candidates: string[], maxDistance = 3): string[] {
  return candidates
    .map((c) => ({ name: c, dist: levenshtein(input.toLowerCase(), c.toLowerCase()) }))
    .filter((c) => c.dist <= maxDistance)
    .sort((a, b) => a.dist - b.dist)
    .map((c) => c.name);
}
