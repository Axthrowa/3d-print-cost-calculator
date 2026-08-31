/// <reference lib="webworker" />
/**
 * G-code gövdesini akış hâlinde tarayan Web Worker.
 * Dosya parça parça okunur; arayüz iş parçacığı bloke olmaz.
 */

import { GcodeScanner } from '../lib/gcodeScanner';

export interface ScanRequest {
  file: File;
}

const CHUNK_BYTES = 8 * 1024 * 1024;

self.onmessage = async (event: MessageEvent<ScanRequest>) => {
  const { file } = event.data;
  const scanner = new GcodeScanner();
  const decoder = new TextDecoder('utf-8');
  let carry = '';

  try {
    for (let offset = 0; offset < file.size; offset += CHUNK_BYTES) {
      const buffer = await file.slice(offset, offset + CHUNK_BYTES).arrayBuffer();
      const text = carry + decoder.decode(buffer, { stream: true });
      const lastBreak = text.lastIndexOf('\n');
      if (lastBreak === -1) {
        carry = text;
      } else {
        scanner.feedChunk(text.slice(0, lastBreak));
        carry = text.slice(lastBreak + 1);
      }
      self.postMessage({
        type: 'progress',
        ratio: Math.min(1, (offset + CHUNK_BYTES) / Math.max(1, file.size)),
      });
    }
    if (carry.length > 0) scanner.feedChunk(carry);
    self.postMessage({ type: 'done', result: scanner.result() });
  } catch (error) {
    self.postMessage({
      type: 'error',
      message: error instanceof Error ? error.message : 'Tarama sırasında hata oluştu.',
    });
  }
};
