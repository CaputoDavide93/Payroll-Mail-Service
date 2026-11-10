import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import AdmZip from 'adm-zip';
import * as XLSX from 'xlsx';
import { extractZip, parseExcel, protectPdf } from '../src/prepare-payslips.js';

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

describe('parseExcel (SheetJS CDN build)', () => {
  it('reads the expected columns and drops rows without email/name', () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
      ['EENo', 'FullName', 'NI No', 'Email Address'],
      ['E001', 'Alice Smith', 'AB123456C', 'alice@example.com'],
      ['E002', '', 'CD234567D', 'nobody@example.com']
    ]), 'Employees');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    assert.deepEqual(parseExcel(buf), [
      { ee_no: 'E001', name: 'Alice Smith', ni_no: 'AB123456C', email: 'alice@example.com' }
    ]);
  });
});

// A well-formed one-page PDF with a correct xref. `qpdf --empty` (zero pages) cannot be encrypted
// by every qpdf 12 build, so the fixture must have a page.
function onePagePdf() {
  const objs = [
    '<</Type/Catalog/Pages 2 0 R>>',
    '<</Type/Pages/Kids[3 0 R]/Count 1>>',
    '<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]/Resources<<>>>>'
  ];
  let out = '%PDF-1.4\n';
  const offsets = objs.map((o, i) => { const at = out.length; out += `${i + 1} 0 obj\n${o}\nendobj\n`; return at; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const at of offsets) out += `${String(at).padStart(10, '0')} 00000 n \n`;
  return out + `trailer\n<</Size ${objs.length + 1}/Root 1 0 R>>\nstartxref\n${xref}\n%%EOF\n`;
}

describe('protectPdf', () => {
  const hasQpdf = (() => {
    try { execFileSync('qpdf', ['--version']); return true; } catch { return false; }
  })();

  it('encrypts with the given password and leaves no argfile behind', { skip: !hasQpdf && 'qpdf not installed' }, async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'payslip-'));
    const input = path.join(dir, 'in.pdf');
    const output = path.join(dir, 'out.pdf');
    fs.writeFileSync(input, onePagePdf());
    const before = fs.readdirSync(os.tmpdir()).filter((f) => f.startsWith('qpdf-'));
    await protectPdf(input, output, 'AB123456C');
    const after = fs.readdirSync(os.tmpdir()).filter((f) => f.startsWith('qpdf-'));
    assert.deepEqual(after, before);
    // --requires-password exits 0 when the file is encrypted
    execFileSync('qpdf', ['--requires-password', output]);
    execFileSync('qpdf', ['--password=AB123456C', '--show-encryption', output]); // non-zero on a wrong password
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
