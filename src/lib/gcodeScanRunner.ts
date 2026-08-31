/**
 * G-code gövde taramasını Web Worker'da çalıştırır.
 * Worker kullanılamıyorsa aynı işi ana iş parçacığında yapar.
 */

import { GcodeScanner, type ScanResult } from './gcodeScanner';

const CHUNK_BYTES = 8 * 1024 * 1024;

export interface ScanHandle {
  promise: Promise<ScanResult>;
  cancel: () => void;
}

/** Ana iş parçacığında akışlı tarama (worker yedeği). */
async function scanOnMainThread(
  file: File,
  onProgress: (ratio: number) => void,
  isCancelled: () => boolean,
): Promise<ScanResult> {
  const scanner = new GcodeScanner();
  const decoder = new TextDecoder('utf-8');
  let carry = '';

  for (let offset = 0; offset < file.size; offset += CHUNK_BYTES) {
    if (isCancelled()) break;
    const buffer = await file.slice(offset, offset + CHUNK_BYTES).arrayBuffer();
    const text = carry + decoder.decode(buffer, { stream: true });
    const lastBreak = text.lastIndexOf('\n');
    if (lastBreak === -1) {
      carry = text;
    } else {
      scanner.feedChunk(text.slice(0, lastBreak));
      carry = text.slice(lastBreak + 1);
    }
    onProgress(Math.min(1, (offset + CHUNK_BYTES) / Math.max(1, file.size)));
    // Arayüzün nefes almasına izin ver.
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  if (carry.length > 0) scanner.feedChunk(carry);
  return scanner.result();
}

/** Taramayı başlatır; iptal edilebilir bir tutamaç döner. */
export function scanGcodeFile(file: File, onProgress: (ratio: number) => void): ScanHandle {
  let cancelled = false;
  let worker: Worker | null = null;

  const promise = new Promise<ScanResult>((resolve, reject) => {
    try {
      worker = new Worker(new URL('../workers/gcodeScan.worker.ts', import.meta.url), {
        type: 'module',
      });
    } catch {
      worker = null;
    }

    if (!worker) {
      scanOnMainThread(file, onProgress, () => cancelled).then(resolve, reject);
      return;
    }

    worker.onmessage = (event: MessageEvent) => {
      const data = event.data as
        | { type: 'progress'; ratio: number }
        | { type: 'done'; result: ScanResult }
        | { type: 'error'; message: string };

      if (cancelled) return;
      if (data.type === 'progress') onProgress(data.ratio);
      else if (data.type === 'done') {
        worker?.terminate();
        resolve(data.result);
      } else {
        worker?.terminate();
        reject(new Error(data.message));
      }
    };

    worker.onerror = () => {
      worker?.terminate();
      worker = null;
      // Worker açılamadıysa ana iş parçacığına düş.
      scanOnMainThread(file, onProgress, () => cancelled).then(resolve, reject);
    };

    worker.postMessage({ file });
  });

  return {
    promise,
    cancel: () => {
      cancelled = true;
      worker?.terminate();
    },
  };
}
