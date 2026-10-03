type Priority = "main" | "background" | "evaluation";
type Waiter = {
  priority: Priority;
  signal: AbortSignal;
  resolve: (release: () => void) => void;
  reject: (error: unknown) => void;
  abort: () => void;
};

/** Daemon-wide model dispatch boundary; waiting never reserves a slot. */
export class ModelSlots {
  private active = 0;
  private readonly queue: Waiter[] = [];
  constructor(readonly capacity = 2) {
    if (!Number.isSafeInteger(capacity) || capacity < 1 || capacity > 32)
      throw Error("Invalid model slot capacity");
  }
  get snapshot() {
    return { active: this.active, waiting: this.queue.length };
  }
  private drain() {
    const rank = { main: 0, background: 1, evaluation: 2 };
    while (this.active < this.capacity && this.queue.length) {
      let best = 0;
      for (let i = 1; i < this.queue.length; i++)
        if (rank[this.queue[i]!.priority] < rank[this.queue[best]!.priority])
          best = i;
      const waiter = this.queue.splice(best, 1)[0]!;
      waiter.signal.removeEventListener("abort", waiter.abort);
      if (waiter.signal.aborted) {
        waiter.reject(waiter.signal.reason);
        continue;
      }
      this.active++;
      let released = false;
      waiter.resolve(() => {
        if (released) return;
        released = true;
        this.active--;
        this.drain();
      });
    }
  }
  private acquire(priority: Priority, signal: AbortSignal) {
    signal.throwIfAborted();
    return new Promise<() => void>((resolve, reject) => {
      const waiter: Waiter = {
        priority,
        signal,
        resolve,
        reject,
        abort: () => {
          const at = this.queue.indexOf(waiter);
          if (at !== -1) this.queue.splice(at, 1);
          reject(signal.reason);
        },
      };
      this.queue.push(waiter);
      signal.addEventListener("abort", waiter.abort, { once: true });
      this.drain();
    });
  }
  async run<T>(
    priority: Priority,
    signal: AbortSignal,
    task: () => Promise<T>,
  ) {
    const release = await this.acquire(priority, signal);
    try {
      signal.throwIfAborted();
      return await task();
    } finally {
      release();
    }
  }
}
