// Import-compilation worker: parsing (incl. .mxl unzip) runs off the main
// thread so the importer's spinner is real and audio never stutters.
import { parseAny } from './parse';
import { SongFormatError } from './types';

export interface WorkerRequest {
  requestId: number;
  bytes: ArrayBuffer;
  fileName: string;
  id: string;
}

export type WorkerResponse =
  | { requestId: number; ok: true; song: unknown; warnings: unknown }
  | { requestId: number; ok: false; formatError: boolean; message: string };

self.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const { requestId, bytes, fileName, id } = e.data;
  try {
    const { song, warnings } = parseAny(new Uint8Array(bytes), fileName, id);
    const response: WorkerResponse = { requestId, ok: true, song, warnings };
    self.postMessage(response);
  } catch (err) {
    const response: WorkerResponse = {
      requestId,
      ok: false,
      formatError: err instanceof SongFormatError,
      message: err instanceof Error ? err.message : 'Import failed',
    };
    self.postMessage(response);
  }
};
