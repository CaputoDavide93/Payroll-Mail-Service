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
  it('rejects per-file oversize PDFs', async () => {
    const buf = makeZip([{ name: 'large.pdf', data: Buffer.alloc(26 * 1024 * 1024) }]);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'payslip-'));
    await assert.rejects(() => extractZip(buf, dir), /File too large/);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('rejects too many files', async () => {
    const entries = Array.from({ length: 501 }, (_, i) => ({ name: `${i}.pdf`, data: Buffer.from('x') }));
    const buf = makeZip(entries);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'payslip-'));
    await assert.rejects(() => extractZip(buf, dir), /too many files/);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('extracts valid small PDF', async () => {
    const buf = makeZip([{ name: 'ok.pdf', data: Buffer.from('%PDF-1.4') }]);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'payslip-'));
    const files = await extractZip(buf, dir);
    assert.deepEqual(files, ['ok.pdf']);
    assert.ok(fs.existsSync(path.join(dir, 'ok.pdf')));
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('cleans real-world filenames instead of dropping them', async () => {
    const buf = makeZip([
      { name: 'Payslip (June 2026).pdf', data: Buffer.from('%PDF-1.4') },
      { name: "O'Brien, Se\u00e1n.pdf", data: Buffer.from('%PDF-1.4') }
    ]);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'payslip-'));
    const files = await extractZip(buf, dir);
    assert.deepEqual(files.slice().sort(), ["O'Brien, Sean.pdf", 'Payslip (June 2026).pdf'].sort());
    files.forEach((f) => assert.ok(fs.existsSync(path.join(dir, f))));
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('strips directory components (no traversal)', async () => {
    const buf = makeZip([{ name: '../../etc/evil.pdf', data: Buffer.from('%PDF-1.4') }]);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'payslip-'));
    const files = await extractZip(buf, dir);
    assert.deepEqual(files, ['evil.pdf']);
    assert.ok(fs.existsSync(path.join(dir, 'evil.pdf')));
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
