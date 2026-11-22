/**
 * One job at a time in its own worker. A new job replaces the running one:
 * the worker is terminated (that is the only way to stop a busy generator)
 * and a fresh one starts, so clicking another chunk never queues behind a
 * slow 16x map. Without module workers, jobs run on the main thread.
 */
import {
  runBake,
  runChunk,
  type BakeJob,
  type ChunkJob,
  type WorldGenJob,
  type WorldGenReply,
} from './jobs';

export type JobListener = (reply: WorldGenReply) => void;

export class JobRunner {
  private worker: Worker | null = null;
  private busy = false;
  private nextId = 1;
  private current = 0;
  private disposed = false;

  constructor(private readonly listen: JobListener) {}

  /** Id of the job in flight (0 when idle). */
  get running(): number {
    return this.busy ? this.current : 0;
  }

  /** Start a job, replacing any running one. Returns its id. */
  start(job: Omit<BakeJob, 'id'> | Omit<ChunkJob, 'id'>): number {
    if (this.disposed) return 0;
    const id = this.nextId++;
    const full = { ...job, id } as WorldGenJob;
    if (this.busy) this.cancel();
    this.current = id;
    this.busy = true;
    const worker = this.ensureWorker();
    if (worker) {
      worker.postMessage(full);
    } else {
      // Main-thread fallback: still async so the caller can paint a progress state first.
      setTimeout(() => {
        if (this.current !== id || !this.busy) return;
        try {
          const reply = full.type === 'bake' ? runBake(full) : runChunk(full);
          this.accept(reply);
        } catch (error) {
          this.accept({ type: 'error', id, message: String(error) });
        }
      }, 0);
    }
    return id;
  }

  /** Stop the running job (its result will never arrive). */
  cancel(): void {
    if (!this.busy) return;
    this.busy = false;
    this.current = 0;
    this.worker?.terminate();
    this.worker = null;
  }

  dispose(): void {
    this.cancel();
    this.worker?.terminate();
    this.worker = null;
    this.disposed = true;
  }

  private accept(reply: WorldGenReply): void {
    if (reply.id !== this.current) return;
    if (reply.type !== 'progress') this.busy = false;
    this.listen(reply);
  }

  private ensureWorker(): Worker | null {
    if (this.worker) return this.worker;
    if (typeof Worker === 'undefined') return null;
    try {
      const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
      worker.onmessage = (event: MessageEvent<WorldGenReply>) => this.accept(event.data);
      worker.onerror = (event) => {
        event.preventDefault();
        this.accept({ type: 'error', id: this.current, message: 'World Gen worker failed' });
        this.worker?.terminate();
        this.worker = null;
      };
      this.worker = worker;
      return worker;
    } catch {
      return null;
    }
  }
}
