import { readFileSync } from "node:fs";
import { Box, type CustomHarnessConfig } from "@upstash/box";
import { announceBox, resolveBoxId } from "../core/box-ref.js";
import { CliError } from "../core/errors.js";
import { emit, requireToken, type GlobalFlags } from "../core/io.js";
import { buildNetworkPolicy } from "../core/network-policy.js";

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
 * @param mode - allow-all, deny-all, or custom.
 * @param flags - the merged flags, with the allow and deny lists.
 */
export async function networkPolicyCommand(mode: string, flags: ConfigFlags): Promise<void> {
  const policy = buildNetworkPolicy(mode, flags);

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
