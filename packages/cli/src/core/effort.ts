import { CliError } from "./errors.js";

/**
 * The agent option that sets effort for each harness, and the levels it takes.
 *
 * Each harness names the option differently, so one `--effort` flag has to be
 * translated per box. Levels mirror the SDK's option types. Harnesses missing
 * here (Cursor, custom) have no effort option.
 */
const EFFORT_OPTION: Record<string, { key: string; levels: readonly string[] }> = {
  "claude-code": { key: "effort", levels: ["low", "medium", "high", "max"] },
  codex: {
    key: "modelReasoningEffort",
    levels: ["none", "minimal", "low", "medium", "high", "xhigh"],
  },
  opencode: { key: "reasoningEffort", levels: ["low", "medium", "high"] },
};

/**
 * Translate `--effort` into the agent options for the box's harness.
 * @param harness - the box's harness, from `box.modelConfig.harness`.
 * @param level - the level the user passed.
 * @returns a one-key options object for the SDK.
 */
export function effortOptions(harness: string | undefined, level: string): Record<string, string> {
  const option = harness === undefined ? undefined : EFFORT_OPTION[harness];
  if (!option) {
    throw new CliError(
      `--effort is not supported for the ${harness ?? "unknown"} harness. ` +
        `It works with ${Object.keys(EFFORT_OPTION).join(", ")}.`,
    );
  }
  if (!option.levels.includes(level)) {
    throw new CliError(
      `Invalid --effort "${level}" for ${harness}. Use one of: ${option.levels.join(", ")}`,
    );
  }
  return { [option.key]: level };
}
