import { BoxApiKey } from "@upstash/box";

/**
 * Resolve the --agent-api-key flag value to a BoxApiKey or direct key string.
 *
 * - undefined / true (flag present with no value) → BoxApiKey.UpstashKey
 * - "stored"                                      → BoxApiKey.StoredKey
 * - any other string                              → passed through as a direct API key
 */
export function resolveAgentApiKey(flag?: string | true): BoxApiKey | string {
  if (flag === undefined || flag === true) {
    return BoxApiKey.UpstashKey;
  }

  if (flag.toLowerCase() === "stored") {
    return BoxApiKey.StoredKey;
  }

  return flag;
}
