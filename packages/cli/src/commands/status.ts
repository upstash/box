import { Box } from "@upstash/box";
import { announceBox, findBoxFile, resolveBoxId } from "../core/box-ref.js";
import { emit, requireToken, type GlobalFlags } from "../core/io.js";

/**
 * Report which box is selected, where that came from, and what it is doing.
 *
 * Also the first exercise of the resolution order, the stderr banner and the
 * exit-code mapping, so those are proven by a real command before anything
 * larger is built on them.
 * @param flags - resolved global flags.
 */
export async function statusCommand(flags: GlobalFlags): Promise<void> {
  const resolved = resolveBoxId({ flag: flags.box });
  announceBox(resolved);

  const apiKey = requireToken(flags.token);
  const box = await Box.get(resolved.id, { apiKey });
  const { status } = await box.getStatus();

  const shadowed =
    resolved.source === "env" && findBoxFile(process.cwd()) !== undefined
      ? findBoxFile(process.cwd())
      : undefined;

  emit(
    {
      id: resolved.id,
      status,
      source: resolved.source,
      ...(resolved.path === undefined ? {} : { source_path: resolved.path }),
      ...(shadowed === undefined ? {} : { shadowed_box_file: shadowed }),
    },
    [
      `${resolved.id} is ${status}`,
      ...(status === "paused" ? ["It resumes automatically on the next command."] : []),
      // BOX_ID winning over a checked-out .box is deliberate, and is the case
      // where someone is most likely to think they are talking to another box.
    ],
    flags,
  );
}
