/**
 * Combine cancellations without `AbortSignal.any`.
 *
 * `AbortSignal.any` landed in Node 18.17 and 20.3, while this package supports
 * Node 18, so calling it would throw on an older runtime before the operation
 * even started. The same reason `deferred.ts` exists.
 *
 * `dispose()` detaches the listeners. The native version drops them by weak
 * reference; here a long-lived caller signal would otherwise retain every
 * combined signal derived from it.
 * @param sources - the signals to combine; the first abort wins.
 * @returns the combined signal and its listener cleanup.
 */
export function anySignal(sources: readonly AbortSignal[]): {
  readonly signal: AbortSignal;
  readonly dispose: () => void;
} {
  const controller = new AbortController();
  const detachers: Array<() => void> = [];
  const dispose = (): void => {
    for (const detach of detachers) detach();
    detachers.length = 0;
  };
  const already = sources.find((source) => source.aborted);
  if (already !== undefined) {
    controller.abort(already.reason);
    return { signal: controller.signal, dispose };
  }
  for (const source of sources) {
    const onAbort = (): void => {
      controller.abort(source.reason);
      dispose();
    };
    source.addEventListener("abort", onAbort, { once: true });
    detachers.push(() => {
      source.removeEventListener("abort", onAbort);
    });
  }
  return { signal: controller.signal, dispose };
}
