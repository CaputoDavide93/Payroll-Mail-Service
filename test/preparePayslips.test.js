import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import AdmZip from 'adm-zip';
import { extractZip } from '../src/preparePayslips.js';

function makeZip(entries) {
  const zip = new AdmZip();
  entries.forEach(({ name, data }) => zip.addFile(name, data));
  return zip.toBuffer();
}

describe('extractZip limits', () => {
  it('rejects per-file oversize PDFs', () => {
    const buf = makeZip([{ name: 'large.pdf', data: Buffer.alloc(26 * 1024 * 1024) }]);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'payslip-'));
    assert.throws(() => extractZip(buf, dir), /File too large/);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('rejects too many files', () => {
    const entries = Array.from({ length: 501 }, (_, i) => ({ name: `${i}.pdf`, data: Buffer.from('x') }));
    const buf = makeZip(entries);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'payslip-'));
    assert.throws(() => extractZip(buf, dir), /too many files/);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('extracts valid small PDF', () => {
    const buf = makeZip([{ name: 'ok.pdf', data: Buffer.from('%PDF-1.4') }]);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'payslip-'));
    const files = extractZip(buf, dir);
    assert.deepEqual(files, ['ok.pdf']);
    assert.ok(fs.existsSync(path.join(dir, 'ok.pdf')));
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
