import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';
import { execFileSync } from 'node:child_process';
import AdmZip from 'adm-zip';
import * as XLSX from 'xlsx';

// Buffers passed as workerData arrive in the thread as plain Uint8Arrays.
// This runs the real worker the way server.js does, so the ZIP and Excel
// readers see exactly what they see in production.
function runWorker(excel, zip) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('../src/payslip-job-worker.js', import.meta.url), {
      workerData: { excel, zip, apiKey: '' }
    });
    worker.once('message', (msg) => { worker.terminate(); resolve(msg); });
    worker.once('error', reject);
  });
}

const hasQpdf = (() => {
  try { execFileSync('qpdf', ['--version']); return true; } catch { return false; }
})();

describe('payslip job worker', () => {
  // The pipeline checks for qpdf before it opens the ZIP.
  it('reads the uploaded ZIP and Excel across the thread boundary', { skip: !hasQpdf && 'qpdf not installed' }, async () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
      ['EENo', 'FullName', 'NI No', 'Email Address'],
      ['E001', 'Alice Smith', 'AB123456C', 'alice@example.com']
    ]), 'Employees');
    const excel = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    const z = new AdmZip();
    z.addFile('E001 Alice Smith.pdf', Buffer.from('%PDF-1.4\n%%EOF\n'));
    const msg = await runWorker(excel, z.toBuffer());
    assert.doesNotMatch(String(msg.error || ''), /No valid PDF files/);
    assert.equal(msg.ok, true);
    if (msg.result?.run_id) {
      const fs = await import('node:fs');
      fs.rmSync(new URL(`../data/payslips/${msg.result.run_id}`, import.meta.url), { recursive: true, force: true });
    }
  });
});
