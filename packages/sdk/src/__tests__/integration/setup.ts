import dotenv from "dotenv";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Box, ClaudeCode } from "../../index.js";
import type { BoxConfig } from "../../index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, "../../../../../.env") });

export const UPSTASH_BOX_API_KEY = process.env.UPSTASH_BOX_API_KEY;
export const CONTEXT7_API_KEY = process.env.CONTEXT7_API_KEY;

// ── Shared box (lazy singleton, scoped per test file) ──

let _sharedBoxPromise: Promise<Box> | null = null;

function _getSharedBox(): Promise<Box> {
  if (!_sharedBoxPromise) {
    _sharedBoxPromise = Box.create({
      apiKey: UPSTASH_BOX_API_KEY!,
      agent: { model: ClaudeCode.Opus_4_6 },
    });
  }
  return _sharedBoxPromise;
}

/**
 * Delete the shared box created by `withBox(..., { shared: true })`.
 * Call this in `afterAll` of any test file that uses the shared option.
 */
export async function cleanupSharedBox(): Promise<void> {
  if (_sharedBoxPromise) {
    const box = await _sharedBoxPromise;
    _sharedBoxPromise = null;
    await box.delete().catch(() => {});
  }
}

// ── Per-test helpers ──

/**
 * Run a callback with a box, then delete it.
 *
 * By default a fresh box is created for every call.
 * Pass `{ shared: true }` to reuse a single lazily-created box that lives
 * for the lifetime of the test file.  Use this when the test does not depend
 * on a clean box (e.g. read-only queries, independent agent runs).
 */
export async function withBox(
  fn: (box: Box) => Promise<void>,
  config?: Partial<BoxConfig> & { shared?: boolean; model?: string },
): Promise<void> {
  if (config?.shared) {
    const box = await _getSharedBox();
    await fn(box);
    return;
  }

  const { shared: _, model, ...boxConfig } = config ?? {};
  const box = await Box.create({
    apiKey: UPSTASH_BOX_API_KEY!,
    agent: { model: model ?? ClaudeCode.Haiku_4_5 },
    ...boxConfig,
  });
  try {
    await fn(box);
  } finally {
    await box.delete().catch(() => {});
  }
}

/**
 * Create a box from a snapshot, run the callback, then delete the box.
 */
export async function withBoxFromSnapshot(
  snapshotId: string,
  fn: (box: Box) => Promise<void>,
): Promise<void> {
  const box = await Box.fromSnapshot(snapshotId, {
    apiKey: UPSTASH_BOX_API_KEY!,
    agent: { model: ClaudeCode.Haiku_4_5 },
  });
  try {
    await fn(box);
  } finally {
    await box.delete().catch(() => {});
  }
}
