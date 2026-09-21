import { Worker } from 'node:worker_threads';
import type { Limits } from '../config.js';
import type { ImageReference } from '../core/markdown.js';
import type { AcquiredImage } from '../core/convert.js';
import type { Diagnostic } from '../core/diagnostics.js';
import { ExportError } from './errors.js';
export async function runWorker(markdown: string, limits: Limits, signal: AbortSignal, acquire: (refs: ImageReference[], signal: AbortSignal) => Promise<{ assets: AcquiredImage[]; warnings: Diagnostic[] }>): Promise<{ data: Uint8Array; warnings: Diagnostic[] }> {
  signal.throwIfAborted();
  const lifetime = new AbortController();
  const ioSignal = AbortSignal.any([signal, lifetime.signal]);
  const worker = new Worker(new URL('./worker-entry.js', import.meta.url), { workerData: { markdown, limits }, execArgv: [] });
  let pendingAcquisition: Promise<void> | undefined;
  let abort: () => void = () => {};
  try {
    return await new Promise((resolve, reject) => {
      let receivedImages = false;
      abort = () => reject(signal.reason);
      signal.addEventListener('abort', abort, { once: true });
      worker.on('error', error => reject(new ExportError('Conversion worker failed.', 'CONVERSION_FAILED', { cause: error })));
      worker.on('exit', () => reject(new ExportError('Conversion worker exited before delivering a result.', 'CONVERSION_FAILED')));
      worker.on('message', (message: { type: string; images?: ImageReference[]; data?: Uint8Array; warnings?: Diagnostic[]; code?: string; message?: string }) => {
        if (signal.aborted) return;
        if (message.type === 'images' && !receivedImages && Array.isArray(message.images)) {
          receivedImages = true;
          pendingAcquisition = acquire(message.images, ioSignal).then(result => { if (!signal.aborted) worker.postMessage(result); }, reject);
        } else if (message.type === 'result' && receivedImages && message.data instanceof Uint8Array && Array.isArray(message.warnings)) resolve({ data: message.data, warnings: message.warnings });
        else if (message.type === 'error') reject(new ExportError(message.message ?? 'Conversion failed.', message.code === 'LIMIT_EXCEEDED' ? 'LIMIT_EXCEEDED' : 'CONVERSION_FAILED'));
        else reject(new ExportError('Invalid conversion worker message.', 'CONVERSION_FAILED'));
      });
      if (signal.aborted) abort();
    });
  } finally {
    signal.removeEventListener('abort', abort);
    lifetime.abort(new DOMException('Conversion worker stopped.', 'AbortError'));
    await worker.terminate();
    await pendingAcquisition;
  }
}
