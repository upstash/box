/**
 * Resolves the API token from flag or environment variable.
 */
export function resolveToken(flagToken?: string): string {
  const token = flagToken ?? process.env.UPSTASH_BOX_TOKEN;
  if (!token) {
    console.error("Error: API token required. Use --token flag or set UPSTASH_BOX_TOKEN env var.");
    process.exit(1);
  }
  return token;
}
