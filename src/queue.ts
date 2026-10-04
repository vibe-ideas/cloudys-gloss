type Job = { start: () => void; cancel: () => void };
export class ConcurrencyQueue {
  private active = 0;
  private jobs: Job[] = [];
  constructor(private limit = 2) {}
  setLimit(limit: number) { this.limit = limit; this.drain(); }
  run<T>(task: () => Promise<T>, signal: AbortSignal, priority = false): Promise<T> {
    return new Promise((resolve, reject) => {
      if (signal.aborted) { reject(signal.reason); return; }
      const job: Job = {
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
      if (priority) this.jobs.unshift(job); else this.jobs.push(job);
      this.drain();
    });
  }
  private drain() {
    while (this.active < this.limit && this.jobs.length) this.jobs.shift()!.start();
  }
}
