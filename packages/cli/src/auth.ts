/**
 * Resolves the API token from flag or environment variable.
 */
export function resolveToken(flagToken?: string): string {
  const token = flagToken ?? process.env.UPSTASH_BOX_API_KEY;
  if (!token) {
    console.error(
      "Error: API token required. Use --token flag or set UPSTASH_BOX_API_KEY env var.",
    );
    process.exit(1);
  }
  return token;
}
