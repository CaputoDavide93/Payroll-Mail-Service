import { parentPort, workerData } from 'node:worker_threads';
import { preparePayslips } from './prepare-payslips.js';

(async () => {
  try {
    // Buffers cross the thread boundary as plain Uint8Arrays (structured clone),
    // and the ZIP/Excel readers need real Buffers — without this every upload
    // failed with "No valid PDF files found".
    const excel = Buffer.from(workerData.excel);
    const zip = Buffer.from(workerData.zip);
    const result = await preparePayslips(excel, zip, workerData.apiKey);
    parentPort.postMessage({ ok: true, result });
  } catch (err) {
    parentPort.postMessage({ ok: false, error: err?.message || String(err) });
  }
})();
