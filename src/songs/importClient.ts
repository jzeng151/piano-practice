import type { ImportWarning, PracticeSong } from './types';
import { SongFormatError } from './types';
import type { WorkerRequest, WorkerResponse } from './worker';

let worker: Worker | null = null;
let nextRequestId = 1;
const pending = new Map<
  number,
  { resolve: (v: { song: PracticeSong; warnings: ImportWarning[] }) => void; reject: (e: Error) => void }
>();

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
      const p = pending.get(e.data.requestId);
      if (!p) return;
      pending.delete(e.data.requestId);
      if (e.data.ok) {
        p.resolve({
          song: e.data.song as PracticeSong,
          warnings: e.data.warnings as ImportWarning[],
        });
      } else {
        p.reject(e.data.formatError ? new SongFormatError(e.data.message) : new Error(e.data.message));
      }
    };
    worker.onerror = () => {
      for (const [, p] of pending) p.reject(new Error('Import failed'));
      pending.clear();
    };
  }
  return worker;
}

/** Parse a file off the main thread. */
export function parseInWorker(
  bytes: ArrayBuffer,
  fileName: string,
  id: string,
): Promise<{ song: PracticeSong; warnings: ImportWarning[] }> {
  return new Promise((resolve, reject) => {
    const requestId = nextRequestId++;
    pending.set(requestId, { resolve, reject });
    const msg: WorkerRequest = { requestId, bytes, fileName, id };
    getWorker().postMessage(msg, [bytes]);
  });
}
