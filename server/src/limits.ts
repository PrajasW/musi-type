/** A tiny counting semaphore with a wait timeout, so a burst of requests can't spawn unlimited yt-dlp processes. */
export class BusyError extends Error {
  constructor() {
    super('The server is busy right now. Try again in a moment.');
    this.name = 'BusyError';
  }
}

export class Semaphore {
  private active = 0;
  private waiting: (() => void)[] = [];

  constructor(private max: number) {}

  get inFlight() {
    return this.active;
  }

  private acquire(timeoutMs: number): Promise<void> {
    if (this.active < this.max) {
      this.active++;
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
      const wake = () => {
        clearTimeout(timer);
        this.active++;
        resolve();
      };
      const timer = setTimeout(() => {
        this.waiting = this.waiting.filter((w) => w !== wake);
        reject(new BusyError());
      }, timeoutMs);
      this.waiting.push(wake);
    });
  }

  private release() {
    this.active--;
    this.waiting.shift()?.();
  }

  async run<T>(fn: () => Promise<T>, waitMs = 20_000): Promise<T> {
    await this.acquire(waitMs);
    try {
      return await fn();
    } finally {
      this.release();
    }
  }
}
