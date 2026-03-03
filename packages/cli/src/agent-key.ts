import { BoxApiKey } from "@upstash/box";

/**
 * Resolve the --agent-api-key flag value to a BoxApiKey or direct key string.
 *
 * - undefined                                     → undefined (server decides)
 * - true (flag present with no value)             → undefined (server decides)
 * - "stored"                                      → BoxApiKey.StoredKey
 * - any other string                              → passed through as a direct API key
 */
export function resolveAgentApiKey(flag?: string | true): BoxApiKey | string | undefined {
  if (flag === undefined || flag === true) {
    return undefined;
  }

  if (flag.toLowerCase() === "stored") {
    return BoxApiKey.StoredKey;
  }

  return flag;
}
