/** Module worker for World Gen: planet bakes and on-demand chunk maps. */
import { replyTransfer, runBake, runChunk, type WorldGenJob, type WorldGenReply } from './jobs';

interface WorkerScope {
  onmessage: ((event: MessageEvent<WorldGenJob>) => void) | null;
  postMessage(message: WorldGenReply, transfer: Transferable[]): void;
}

const scope = self as unknown as WorkerScope;

scope.onmessage = (event) => {
  const job = event.data;
  try {
    const reply =
      job.type === 'bake'
        ? runBake(job, (done) => scope.postMessage({ type: 'progress', id: job.id, done }, []))
        : runChunk(job);
    scope.postMessage(reply, replyTransfer(reply));
  } catch (error) {
    scope.postMessage(
      {
        type: 'error',
        id: job.id,
        message: error instanceof Error ? error.message : String(error),
      },
      [],
    );
  }
};
