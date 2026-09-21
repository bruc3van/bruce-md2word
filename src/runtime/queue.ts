import { ExportError } from './errors.js';
interface Waiter { start: () => void; reject: (reason: unknown) => void; signal: AbortSignal; abort: () => void }
/** Per-plugin admission and cleanup. A deadline includes time spent queued. */
export class TaskQueue {
  private active = 0;
  private closed = false;
  private readonly waiting: Waiter[] = [];
  private readonly shutdown = new AbortController();
  private readonly tasks = new Set<Promise<unknown>>();
  constructor(private readonly concurrency: number, private readonly queueSize: number, private readonly timeoutMs: number) {}
  run<T>(signal: AbortSignal, work: (signal: AbortSignal) => Promise<T>): Promise<T> {
    if (this.closed) return Promise.reject(new ExportError('Plugin is unloading.', 'BUSY'));
    const timer = new AbortController();
    const handle = setTimeout(() => timer.abort(new ExportError('Conversion deadline exceeded.', 'LIMIT_EXCEEDED')), this.timeoutMs);
    const combined = AbortSignal.any([signal, timer.signal, this.shutdown.signal]);
    const task = this.enter(combined).then(async () => {
      try { combined.throwIfAborted(); return await work(combined); }
      catch (error) { combined.throwIfAborted(); throw error; }
      finally { this.active--; this.drain(); }
    }).finally(() => { clearTimeout(handle); this.tasks.delete(task); });
    this.tasks.add(task);
    return task;
  }
  private enter(signal: AbortSignal): Promise<void> {
    if (signal.aborted) return Promise.reject(signal.reason);
    if (this.active < this.concurrency) { this.active++; return Promise.resolve(); }
    if (this.waiting.length >= this.queueSize) return Promise.reject(new ExportError('Conversion queue is full.', 'BUSY'));
    return new Promise((resolve, reject) => {
      const waiter: Waiter = { signal, start: resolve, reject, abort: () => {
        const index = this.waiting.indexOf(waiter);
        if (index >= 0) this.waiting.splice(index, 1);
        reject(signal.reason);
      } };
      signal.addEventListener('abort', waiter.abort, { once: true });
      this.waiting.push(waiter);
    });
  }
  private drain(): void {
    while (!this.closed && this.active < this.concurrency && this.waiting.length) {
      const waiter = this.waiting.shift()!;
      waiter.signal.removeEventListener('abort', waiter.abort);
      if (waiter.signal.aborted) { waiter.reject(waiter.signal.reason); continue; }
      this.active++; waiter.start();
    }
  }
  async dispose(): Promise<void> {
    this.closed = true;
    this.shutdown.abort(new DOMException('Plugin unloaded.', 'AbortError'));
    await Promise.allSettled([...this.tasks]);
  }
}
