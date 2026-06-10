import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import AdmZip from 'adm-zip';
import * as XLSX from 'xlsx';
import { matchAttachments } from './matchAttachments.js';
import { DATA_DIR } from './db.js';

const execFileAsync = promisify(execFile);

export const PAYSLIPS_DIR = path.join(DATA_DIR, 'payslips');

// Parse Excel buffer → [{ee_no, name, ni_no, email}]
export function parseExcel(buffer) {
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });

  // Normalize headers: strip spaces, lowercase
  return rows.map((row) => {
    const norm = {};
    for (const [k, v] of Object.entries(row)) {
      norm[k.toLowerCase().replace(/\s+/g, '_')] = String(v).trim();
    }
    return {
      ee_no: norm['eeno'] || norm['ee_no'] || norm['employee_no'] || '',
      name: norm['fullname'] || norm['full_name'] || norm['name'] || '',
      ni_no: norm['ni_no'] || norm['nino'] || norm['ni_number'] || norm['national_insurance'] || '',
      email: norm['email_address'] || norm['email'] || ''
    };
  }).filter((r) => r.email && r.name);
}

// Extract ZIP buffer → folder, returns list of extracted PDF filenames
export function extractZip(buffer, destFolder) {
  fs.mkdirSync(destFolder, { recursive: true });
  const zip = new AdmZip(buffer);
  const entries = zip.getEntries()
    .filter((e) => !e.isDirectory && path.extname(e.entryName).toLowerCase() === '.pdf');
  for (const entry of entries) {
    const outPath = path.join(destFolder, path.basename(entry.entryName));
    fs.writeFileSync(outPath, entry.getData());
  }
  return entries.map((e) => path.basename(e.entryName));
}

// Password-protect a PDF using qpdf (256-bit AES).
export async function protectPdf(inputPath, outputPath, password) {
  await execFileAsync('qpdf', [
    '--encrypt', password, password, '256',
    '--',
    inputPath,
    outputPath
  ]);
}

/**
 * Full pipeline: parse Excel + extract ZIP → AI-match → protect each PDF.
 *
 * Returns:
 *   results       [{email, name, ni_no, protected_path, filename, confidence}]
 *   unmatched     recipients with no matching PDF
 *   unmatched_files  PDFs not claimed by any recipient
 *   protect_errors  [{email, error}]
 *   ai_errors     string[]
 */
export async function preparePayslips(xlsxBuffer, zipBuffer, apiKey) {
  const runId = Date.now().toString(36);
  const rawDir = path.join(PAYSLIPS_DIR, runId, 'raw');
  const protectedDir = path.join(PAYSLIPS_DIR, runId, 'protected');
  fs.mkdirSync(rawDir, { recursive: true });
  fs.mkdirSync(protectedDir, { recursive: true });

  // 1. Parse recipients from Excel
  const recipients = parseExcel(xlsxBuffer);
  if (recipients.length === 0) throw new Error('No valid recipients found in Excel file.');

  // 2. Extract PDFs from ZIP
  extractZip(zipBuffer, rawDir);

  // 3. Match filenames → recipients (AI + fuzzy)
  const { matched, unmatched, unmatched_files, ai_errors } = await matchAttachments(
    recipients.map((r) => ({ email: r.email, name: r.name })),
    rawDir,
    apiKey
  );

  // Build a lookup: email → recipient row (for ni_no)
  const recipientMap = new Map(recipients.map((r) => [r.email.toLowerCase(), r]));

  // 4. Password-protect each matched PDF
  const results = [];
  const protect_errors = [];

  for (const m of matched) {
    const rec = recipientMap.get(m.email.toLowerCase());
    if (!rec) continue;
    if (!rec.ni_no) {
      protect_errors.push({ email: m.email, error: 'Missing NI No — cannot set password.' });
      continue;
    }
    const outName = path.basename(m.filename, '.pdf') + '_protected.pdf';
    const outPath = path.join(protectedDir, outName);
    try {
      await protectPdf(m.path, outPath, rec.ni_no);
      results.push({
        email: m.email,
        name: m.name,
        ni_no: rec.ni_no,
        filename: outName,
        protected_path: outPath,
        confidence: m.confidence
      });
    } catch (err) {
      protect_errors.push({ email: m.email, error: err.message });
    }
  }

  return { results, unmatched, unmatched_files, protect_errors, ai_errors, run_id: runId };
}
