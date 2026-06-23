import { parentPort, workerData } from 'node:worker_threads';
import { prepareForReview } from './preparePayslips.js';

// Buffers sent via workerData are structured-cloned into plain Uint8Arrays (no Buffer
// methods like .copy that yauzl/xlsx rely on) — rehydrate them to real Buffers.
const toBuffer = (b) => (Buffer.isBuffer(b) ? b : Buffer.from(b));

(async () => {
  try {
    const result = await prepareForReview(toBuffer(workerData.excel), toBuffer(workerData.zip), workerData.apiKey);
    parentPort.postMessage({ ok: true, result });
  } catch (err) {
    parentPort.postMessage({ ok: false, error: err?.message || String(err) });
  }
})();
