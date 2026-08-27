import { clearBoxFile, writeBoxFile, BOX_FILE } from "../core/box-ref.js";
import { CliError } from "../core/errors.js";
import { emit, type GlobalFlags } from "../core/io.js";

/**
 * Record, or clear, the box this directory works against.
 *
 * Once written, later commands need no `--box`.
 * @param boxId - box to select; omitted with --unset.
 * @param flags - resolved global flags, plus --unset.
 */
export async function useCommand(
  boxId: string | undefined,
  flags: GlobalFlags & { unset?: boolean },
): Promise<void> {
  if (flags.unset) {
    // Throws when this directory has no file of its own, naming the nearest
    // rather than deleting a pin that belongs to a parent.
    const removed = clearBoxFile();
    emit({ unset: removed }, `Removed ${removed}`, flags);
    return;
  }

  const id = boxId?.trim();
  if (!id) throw new CliError(`Usage: box use <box-id> | box use --unset`);

  const written = writeBoxFile(id);
  emit(
    { id, path: written },
    [
      `Using ${id}`,
      `Written to ${written}`,
      // Local state: it names a box that belongs to one account and one machine.
      `${BOX_FILE} is local state — add it to .gitignore rather than committing it.`,
    ],
    flags,
  );
}
