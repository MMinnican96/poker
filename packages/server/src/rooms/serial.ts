/**
 * Runs async tasks one at a time, in order. Table operations that touch the bank
 * go through here so in-memory seat state and escrow never interleave.
 */
export class Serial {
  private tail: Promise<unknown> = Promise.resolve();

  run<T>(task: () => Promise<T> | T): Promise<T> {
    const next = this.tail.then(task, task);
    this.tail = next.catch(() => undefined);
    return next;
  }

  /** Resolves when everything queued so far has finished. */
  idle(): Promise<void> {
    return this.tail.then(() => undefined);
  }
}

/** Per-key minimum interval between events (emotes, chat). */
export class RateLimiter {
  private readonly last = new Map<string, number[]>();

  constructor(private readonly max: number, private readonly windowMs: number, private readonly clock: () => number = Date.now) {}

  allow(key: string): boolean {
    const now = this.clock();
    const recent = (this.last.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (recent.length >= this.max) {
      this.last.set(key, recent);
      return false;
    }
    recent.push(now);
    this.last.set(key, recent);
    return true;
  }
}
