import type { NetworkPolicy } from "@upstash/box";
import { CliError } from "./errors.js";

export type PolicyLists = {
  allowDomain?: string[];
  allowCidr?: string[];
  denyCidr?: string[];
};

/**
 * Build a network policy from a mode and the three list flags.
 *
 * The modes are exclusive: `allow-all` and `deny-all` take no lists, and any
 * list implies `custom`. Sending a list with a blanket mode would look like it
 * narrowed the policy while doing nothing.
 * @param mode - allow-all, deny-all, or custom.
 * @param lists - the allow and deny lists as given.
 * @returns the policy to send.
 */
export function buildNetworkPolicy(mode: string, lists: PolicyLists): NetworkPolicy {
  const count =
    (lists.allowDomain?.length ?? 0) +
    (lists.allowCidr?.length ?? 0) +
    (lists.denyCidr?.length ?? 0);

  if (mode !== "allow-all" && mode !== "deny-all" && mode !== "custom") {
    throw new CliError("mode must be one of: allow-all, deny-all, custom");
  }
  if (mode !== "custom" && count > 0) {
    throw new CliError(
      `--allow-domain, --allow-cidr and --deny-cidr only apply to 'custom', not '${mode}'`,
    );
  }
  if (mode === "custom" && count === 0) {
    throw new CliError("custom needs at least one of --allow-domain, --allow-cidr or --deny-cidr");
  }

  return mode === "custom"
    ? {
        mode: "custom",
        ...(lists.allowDomain?.length ? { allowedDomains: lists.allowDomain } : {}),
        ...(lists.allowCidr?.length ? { allowedCidrs: lists.allowCidr } : {}),
        ...(lists.denyCidr?.length ? { deniedCidrs: lists.denyCidr } : {}),
      }
    : { mode };
}
