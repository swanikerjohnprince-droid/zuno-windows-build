/**
 * Single-flight scheduler for navigation steps: at most one operation runs at a time, and any
 * that arrive while one is running collapse into a single follow-up — the most recently
 * requested one, not one per call.
 *
 * Built for skip forward/back. Queueing one full load per click meant a burst of rapid skips
 * paid for a full resolve-and-decode cycle per click before the last one landed — 1-4.5s each,
 * measured. Collapsing is a correctness fix as much as a speed one: the audio engine has a
 * single command channel, and two concurrent loads race to decide what ends up on the active
 * deck with no guarantee the most recent click wins, so more than one load in flight at a time
 * is not safe regardless of how fast it runs.
 *
 * Each `operation` is expected to read whatever state it needs fresh when it actually runs
 * (e.g. the current queue position), not capture it at call time — the follow-up only remembers
 * *that* another step is owed, not what the queue looked like when it was requested.
 */
export class NavigationCoalescer {
  private inFlight = false;
  private pending: (() => Promise<void>) | null = null;

  async run(operation: () => Promise<void>): Promise<void> {
    if (this.inFlight) {
      this.pending = operation;
      return;
    }

    this.inFlight = true;
    try {
      let next: (() => Promise<void>) | null = operation;
      while (next) {
        await next();
        next = this.pending;
        this.pending = null;
      }
    } finally {
      this.inFlight = false;
    }
  }
}
