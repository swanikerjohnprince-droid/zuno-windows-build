/**
 * Self-check for the navigation coalescer. Run with the whole suite:
 *
 *   npm run check
 *
 * The property that matters is never having two operations in flight at once — that's the part
 * a skip regression would come back as silently, since it only shows up as a rare audible glitch
 * under rapid clicking rather than a thrown error.
 */
export {};

import { NavigationCoalescer } from "./navigationCoalescer";

function check(condition: boolean, message: string): void {
  if (!condition) throw new Error(`FAILED: ${message}`);
}

function deferred<T = void>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

async function main(): Promise<void> {
  // Calls that do not overlap each run individually, in order.
  {
    const coalescer = new NavigationCoalescer();
    const calls: string[] = [];
    await coalescer.run(async () => {
      calls.push("a");
    });
    await coalescer.run(async () => {
      calls.push("b");
    });
    check(calls.join(",") === "a,b", "two non-overlapping calls both ran, in order");
  }

  // A burst arriving mid-flight collapses to a single follow-up: the most recently requested
  // one, not the first one queued and not one per call.
  {
    const coalescer = new NavigationCoalescer();
    const calls: string[] = [];
    const first = deferred<void>();

    const run1 = coalescer.run(async () => {
      calls.push("first");
      await first.promise;
    });
    // Both arrive while "first" is still in flight.
    const run2 = coalescer.run(async () => {
      calls.push("second");
    });
    const run3 = coalescer.run(async () => {
      calls.push("third");
    });

    check(calls.join(",") === "first", "only the in-flight operation has run so far");

    first.resolve();
    await Promise.all([run1, run2, run3]);

    check(calls.length === 2, "a burst of three collapses to at most two runs");
    check(
      calls.join(",") === "first,third",
      "the follow-up is the most recently requested operation, not the first one queued",
    );
  }

  // The invariant the whole thing exists for: never more than one operation running at once,
  // regardless of burst size.
  {
    const coalescer = new NavigationCoalescer();
    let concurrent = 0;
    let maxConcurrent = 0;
    const barrier = deferred<void>();

    const run = () => coalescer.run(async () => {
      concurrent += 1;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      await barrier.promise;
      concurrent -= 1;
    });

    const runs = [run(), run(), run(), run()];
    barrier.resolve();
    await Promise.all(runs);

    check(maxConcurrent === 1, "no more than one operation ever ran at the same time");
  }

  console.log("navigationCoalescer: ok");
}

void main();
