export class SlidingWindowRateLimiter {
  private readonly starts: number[] = [];
  private queue: Promise<void> = Promise.resolve();

  constructor(
    private readonly requests: number,
    private readonly intervalMs: number,
    private readonly now: () => number,
    private readonly sleep: (milliseconds: number) => Promise<void>,
  ) {
    if (!Number.isInteger(requests) || requests < 1) throw new RangeError('rateLimitRequests must be positive');
    if (!Number.isFinite(intervalMs) || intervalMs <= 0) throw new RangeError('rateLimitIntervalMs must be positive');
  }

  acquire(): Promise<void> {
    const turn = this.queue.then(() => this.waitForSlot());
    this.queue = turn.catch(() => undefined);
    return turn;
  }

  private async waitForSlot(): Promise<void> {
    for (;;) {
      const timestamp = this.now();
      while (this.starts[0] !== undefined && timestamp - this.starts[0] >= this.intervalMs) this.starts.shift();
      if (this.starts.length < this.requests) {
        this.starts.push(timestamp);
        return;
      }
      const oldest = this.starts[0];
      if (oldest !== undefined) await this.sleep(Math.max(1, oldest + this.intervalMs - timestamp));
    }
  }
}
