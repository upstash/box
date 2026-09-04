import { readFileSync } from "node:fs";
import { Box, type CustomHarnessConfig, type NetworkPolicy } from "@upstash/box";
import { announceBox, resolveBoxId } from "../core/box-ref.js";
import { CliError } from "../core/errors.js";
import { emit, requireToken, type GlobalFlags } from "../core/io.js";

export type ConfigFlags = GlobalFlags & {
  command?: string;
  args?: string[];
  allowDomain?: string[];
  allowCidr?: string[];
  denyCidr?: string[];
};

async function open(flags: GlobalFlags): Promise<Box> {
  const resolved = resolveBoxId({ flag: flags.box });
  announceBox(resolved);
  return Box.get(resolved.id, { apiKey: requireToken(flags.token) });
}

/**
 * Point the box's agent at a different model.
 * @param model - the model identifier.
 * @param flags - the merged flags.
 */
export async function configureModelCommand(model: string, flags: GlobalFlags): Promise<void> {
  const box = await open(flags);
  await box.configureModel(model);
  emit({ model }, [`Model set to ${model}`], flags);
}

/**
 * Point the box at a custom agent harness.
 * @param flags - the merged flags; --command names the executable.
 */
export async function configureHarnessCommand(flags: ConfigFlags): Promise<void> {
  if (!flags.command) {
    throw new CliError("--command <executable> is required");
  }

  const box = await open(flags);
  const harness: CustomHarnessConfig = {
    command: flags.command,
    ...(flags.args && flags.args.length > 0 ? { args: flags.args } : {}),
  };
  await box.configureCustomHarness(harness);

  emit(harness, [`Custom harness set to ${flags.command}`], flags);
}

/**
 * Show the box's init command.
 * @param flags - the merged flags.
 */
export async function initCommandGetCommand(flags: GlobalFlags): Promise<void> {
  const box = await open(flags);
  const initCommand = await box.getInitCommand();
  emit(
    { init_command: initCommand ?? null },
    initCommand ? [String(initCommand)] : ["No init command set."],
    flags,
  );
}

/**
 * Set the command the box runs when it starts.
 *
 * `-` reads the command from stdin, so a multi-line script does not have to
 * survive the shell's quoting on the way in.
 * @param command - the command, or `-` for stdin.
 * @param flags - the merged flags.
 */
export async function initCommandSetCommand(command: string, flags: GlobalFlags): Promise<void> {
  const text = command === "-" ? readFileSync(0, "utf8") : command;
  if (!text.trim()) throw new CliError("Init command is empty");

  const box = await open(flags);
  await box.setInitCommand(text);
  emit({ init_command: text }, ["Init command set."], flags);
}

/**
 * Remove the box's init command.
 * @param flags - the merged flags.
 */
export async function initCommandDeleteCommand(flags: GlobalFlags): Promise<void> {
  const box = await open(flags);
  await box.deleteInitCommand();
  emit({ init_command: null }, ["Init command removed."], flags);
}

/**
 * Set the box's network policy.
 *
 * The modes are exclusive: `allow-all` and `deny-all` take no lists, and any
 * list implies `custom`. Sending a list with a blanket mode would look like it
 * narrowed the policy while doing nothing.
 * @param mode - allow-all, deny-all, or custom.
 * @param flags - the merged flags, with the allow and deny lists.
 */
export async function networkPolicyCommand(mode: string, flags: ConfigFlags): Promise<void> {
  const lists =
    (flags.allowDomain?.length ?? 0) +
    (flags.allowCidr?.length ?? 0) +
    (flags.denyCidr?.length ?? 0);

  if (mode !== "allow-all" && mode !== "deny-all" && mode !== "custom") {
    throw new CliError("mode must be one of: allow-all, deny-all, custom");
  }
  if (mode !== "custom" && lists > 0) {
    throw new CliError(
      `--allow-domain, --allow-cidr and --deny-cidr only apply to 'custom', not '${mode}'`,
    );
  }
  if (mode === "custom" && lists === 0) {
    throw new CliError("custom needs at least one of --allow-domain, --allow-cidr or --deny-cidr");
  }

  const policy: NetworkPolicy =
    mode === "custom"
      ? {
          mode: "custom",
          ...(flags.allowDomain?.length ? { allowedDomains: flags.allowDomain } : {}),
          ...(flags.allowCidr?.length ? { allowedCidrs: flags.allowCidr } : {}),
          ...(flags.denyCidr?.length ? { deniedCidrs: flags.denyCidr } : {}),
        }
      : { mode };

  const box = await open(flags);
  await box.updateNetworkPolicy(policy);
  emit(policy, [`Network policy set to ${mode}`], flags);
}

/**
 * Add a skill to the box.
 * @param skillId - the skill to enable.
 * @param flags - the merged flags.
 */
export async function skillsAddCommand(skillId: string, flags: GlobalFlags): Promise<void> {
  const box = await open(flags);
  await box.skills.add(skillId);
  emit({ skill: skillId, enabled: true }, [`Added ${skillId}`], flags);
}

/**
 * Remove a skill from the box.
 * @param skillId - the skill to disable.
 * @param flags - the merged flags.
 */
export async function skillsRemoveCommand(skillId: string, flags: GlobalFlags): Promise<void> {
  const box = await open(flags);
  await box.skills.remove(skillId);
  emit({ skill: skillId, enabled: false }, [`Removed ${skillId}`], flags);
}

/**
 * List the box's enabled skills.
 * @param flags - the merged flags.
 */
export async function skillsListCommand(flags: GlobalFlags): Promise<void> {
  const box = await open(flags);
  const skills = await box.skills.list();
  emit(skills, skills.length === 0 ? ["No skills enabled."] : skills, flags);
}

/**
 * Resume a paused box.
 *
 * Every other command resumes on its own, so this exists for the case where
 * you want the box warm before timing something.
 * @param flags - the merged flags.
 */
export async function resumeCommand(flags: GlobalFlags): Promise<void> {
  const box = await open(flags);
  await box.resume();
  const { status } = await box.getStatus();
  emit({ id: box.id, status }, [`${box.id} is ${status}`], flags);
}
