/**
 * Bounded host-side collection for one Upstash Box output stream.
 *
 * The Box SDK delivers already-decoded raw bytes to `onStdout`/`onStderr`, so
 * this adapter needs no transport decoder. Phase 0 keeps only the in-memory
 * tail: `spillPath` is never advertised, and a lossy read says so.
 */

import { Buffer } from "node:buffer";
import type { SubprocessOutputRead, SubprocessOutputReader } from "@deepseek-ai/dsh-subprocess";

/**
 * Host-side ceiling for `pipe` output that nothing has read yet.
 *
 * A local child writes into an OS pipe, so a consumer that stops reading fills
 * the pipe and the child blocks. This session has no such path: the transport
 * pushes stdout frames unconditionally and exposes no pause, so `push()`
 * returning false cannot slow the box down and the backlog is host memory. A
 * consumer keeping up never approaches this; only one that has stopped does.
 *
 * Collect mode is already bounded by its own `maxBytes`.
 */
export const MAX_UNREAD_OUTPUT_BYTES = 32 * 1024 * 1024;

/** Offset reader over one collect-mode Box stream. */
export class BoxOutputReader implements SubprocessOutputReader {
  private chunks: Buffer[] = [];
  private retainedBytes = 0;
  private totalBytes = 0;

  /**
   * Create a bounded reader.
   * @param maxBytes - In-memory tail cap; overflow discards from the head.
   */
  constructor(private readonly maxBytes: number) {}

  /** Total bytes observed from the session. */
  get size(): number {
    return this.totalBytes;
  }

  /**
   * Append one decoded output event.
   * @param bytes - Raw process bytes from the session callback.
   */
  push(bytes: Uint8Array): void {
    if (bytes.length === 0) return;
    const chunk = Buffer.from(bytes);
    this.totalBytes += chunk.length;
    this.chunks.push(chunk);
    this.retainedBytes += chunk.length;
    while (this.retainedBytes > this.maxBytes) {
      const head = this.chunks[0] as Buffer;
      const excess = this.retainedBytes - this.maxBytes;
      if (head.length <= excess) {
        this.chunks.shift();
        this.retainedBytes -= head.length;
      } else {
        this.chunks[0] = head.subarray(excess);
        this.retainedBytes -= excess;
      }
    }
  }

  /** @inheritdoc */
  readFrom(fromByte: number): SubprocessOutputRead {
    const retained = Buffer.concat(this.chunks, this.retainedBytes);
    const firstRetained = this.totalBytes - this.retainedBytes;
    const lossy = fromByte < firstRetained;
    const start = lossy ? 0 : Math.min(retained.length, Math.max(0, fromByte - firstRetained));
    return {
      text: retained.subarray(start).toString("utf8"),
      nextOffset: this.totalBytes,
      lossy,
    };
  }
}
