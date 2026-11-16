/**
 * A serial queue: each call waits for the previous one to settle before it starts.
 *
 * For state that is only safe to touch one call at a time — a single mutable field two
 * concurrent async calls would otherwise race on, where the fix isn't a return value but simply
 * "don't overlap".
 */
export function createSerialQueue(): <T>(fn: () => Promise<T>) => Promise<T> {
  let tail: Promise<void> = Promise.resolve();

  return function run<T>(fn: () => Promise<T>): Promise<T> {
    const result = tail.then(fn, fn);
    // Chained regardless of outcome, so one failed call does not wedge every call behind it.
    tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };
}
