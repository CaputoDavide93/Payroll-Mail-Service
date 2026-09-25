import { parentPort, workerData } from 'node:worker_threads';
import { preparePayslips } from './prepare-payslips.js';

(async () => {
  try {
    const result = await preparePayslips(workerData.excel, workerData.zip, workerData.apiKey);
    parentPort.postMessage({ ok: true, result });
  } catch (err) {
    parentPort.postMessage({ ok: false, error: err?.message || String(err) });
  }
})();
