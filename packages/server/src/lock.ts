// DESIGN 2, rule 2: one lock per user, and a separate accounts lock. A lock is a FIFO queue.
// Lock order (DESIGN 18, notes for the builder): user locks in order of user id, then the
// accounts lock. The accounts lock is released after the session check, before a user lock.

export type Release = () => void;

export class Mutex {
  #tail: Promise<void> = Promise.resolve();
  #held = false;

  get held(): boolean {
    return this.#held;
  }

  /** Waits for the lock; returns the function that releases it. */
  acquire(): Promise<Release> {
    let release!: Release;
    const next = new Promise<void>((resolve) => {
      release = () => {
        this.#held = false;
        resolve();
      };
    });
    const ready = this.#tail.then(() => {
      this.#held = true;
      let done = false;
      return () => {
        if (done) return;
        done = true;
        release();
      };
    });
    this.#tail = this.#tail.then(() => next);
    return ready;
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    const release = await this.acquire();
    try {
      return await fn();
    } finally {
      release();
    }
  }
}

export class Locks {
  readonly accounts = new Mutex();
  #users = new Map<string, Mutex>();

  user(userId: string): Mutex {
    let m = this.#users.get(userId);
    if (!m) {
      m = new Mutex();
      this.#users.set(userId, m);
    }
    return m;
  }
}
