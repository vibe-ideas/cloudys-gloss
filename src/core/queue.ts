export type RequestPriority = 'interactive' | 'visible' | 'prefetch';
type Job = { start: () => void; cancel: () => void; priority: RequestPriority; signal: AbortSignal };
const rank: Record<RequestPriority, number> = { interactive: 0, visible: 1, prefetch: 2 };
export class ConcurrencyQueue {
  private active = 0;
  private jobs: Job[] = [];
  private bypasses = 0;
  constructor(private limit = 2) {}
  setLimit(limit: number) { this.limit = limit; this.drain(); }
  run<T>(task: () => Promise<T>, signal: AbortSignal, priority: boolean | RequestPriority = false): Promise<T> {
    return new Promise((resolve, reject) => {
      if (signal.aborted) { reject(signal.reason); return; }
      const job: Job = {
        signal,
        priority: typeof priority === 'boolean' ? priority ? 'interactive' : 'visible' : priority,
        cancel: () => {
          this.jobs = this.jobs.filter((item) => item !== job);
          reject(signal.reason);
        },
        start: () => {
          signal.removeEventListener('abort', job.cancel);
          this.active++;
          Promise.resolve().then(() => { signal.throwIfAborted(); return task(); })
            .then(resolve, reject).finally(() => { this.active--; this.drain(); });
        },
      };
      signal.addEventListener('abort', job.cancel, { once: true });
      this.jobs.push(job);
      this.drain();
    });
  }
  updatePriority(signal: AbortSignal, priority: RequestPriority) {
    for (const job of this.jobs) if (job.signal === signal && rank[priority] < rank[job.priority]) job.priority = priority;
  }
  private drain() {
    while (this.active < this.limit && this.jobs.length) {
      // Preserve FIFO within each class. After eight priority overtakes, serve
      // the oldest waiter so continuous interaction cannot starve page reading.
      let index = 0;
      if (this.bypasses < 8) for (let i = 1; i < this.jobs.length; i++) {
        if (rank[this.jobs[i]!.priority] < rank[this.jobs[index]!.priority]) index = i;
      }
      this.bypasses = index ? this.bypasses + 1 : 0;
      this.jobs.splice(index, 1)[0]!.start();
    }
    if (!this.jobs.length) this.bypasses = 0;
  }
}
