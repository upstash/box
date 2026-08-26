/**
 * A promise with its settlement functions exposed.
 *
 * `Promise.withResolvers` would say this in one line, but it landed in Node 22
 * and this package supports Node 18, so the handle would throw on construction
 * for two supported major versions.
 */
export interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
  reject(reason: unknown): void;
}

/**
 * Create a deferred promise.
 * @returns the promise and its settlement functions.
 */
export function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
