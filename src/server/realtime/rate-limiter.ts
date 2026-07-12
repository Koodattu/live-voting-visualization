export class WindowRateLimiter {
  private readonly entries = new Map<
    string,
    { count: number; resetAt: number }
  >();
  private lastSweep = 0;

  constructor(
    private readonly maximum: number,
    private readonly windowMilliseconds: number,
  ) {}

  accept(key: string, timestamp = Date.now()): boolean {
    if (
      timestamp - this.lastSweep >= this.windowMilliseconds ||
      this.entries.size > 10_000
    ) {
      for (const [entryKey, entry] of this.entries) {
        if (entry.resetAt <= timestamp) this.entries.delete(entryKey);
      }
      while (this.entries.size > 10_000) {
        const oldestKey = this.entries.keys().next().value as string | undefined;
        if (!oldestKey) break;
        this.entries.delete(oldestKey);
      }
      this.lastSweep = timestamp;
    }
    const existing = this.entries.get(key);
    if (!existing || existing.resetAt <= timestamp) {
      this.entries.set(key, {
        count: 1,
        resetAt: timestamp + this.windowMilliseconds,
      });
      return true;
    }
    if (existing.count >= this.maximum) return false;
    existing.count += 1;
    return true;
  }
}
