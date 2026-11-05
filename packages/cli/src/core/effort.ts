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

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Set the effort in a schedule's stored agent options, keeping the rest.
 *
 * The backend replaces agent options whole on update, so the new effort has to
 * be merged into what is stored. Two stored shapes would otherwise win over
 * it: Codex options come back snake_case (`model_reasoning_effort`), and an
 * OpenCode `extra_body.reasoning` overrides `reasoningEffort` on OpenRouter.
 * @param harness - the box's harness, from `box.modelConfig.harness`.
 * @param current - the schedule's stored agent options.
 * @param level - the level the user passed.
 * @returns the full options to send.
 */
export function mergeEffort(
  harness: string | undefined,
  current: Record<string, unknown> | undefined,
  level: string,
): Record<string, unknown> {
  const effort = effortOptions(harness, level);
  const merged: Record<string, unknown> = { ...current };

  // Drop the stored snake_case key rather than rely on the SDK's key mapping
  // to let the new camelCase key overwrite it.
  if (harness === "codex") delete merged.model_reasoning_effort;

  // The runner sends a stored extra_body.reasoning as-is on OpenRouter, so the
  // effort is set there too. OpenRouter takes effort or max_tokens, not both.
  if (
    harness === "opencode" &&
    isPlainObject(merged.extra_body) &&
    isPlainObject(merged.extra_body.reasoning)
  ) {
    const { max_tokens: _maxTokens, ...reasoning } = merged.extra_body.reasoning;
    merged.extra_body = { ...merged.extra_body, reasoning: { ...reasoning, effort: level } };
  }

  return { ...merged, ...effort };
}
