import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import yauzl from 'yauzl';
import * as XLSX from 'xlsx';
import { matchAttachments } from './matchAttachments.js';
import { DATA_DIR } from './db.js';
import { getAnthropicApiKey } from './settings.js';

const execFileAsync = promisify(execFile);

// Limits to guard against ZIP bombs and oversized uploads
const MAX_UNZIPPED_BYTES = 200 * 1024 * 1024; // 200 MB across all files
const MAX_FILES = 500;
const MAX_FILE_BYTES = 25 * 1024 * 1024; // 25 MB per PDF

export const PAYSLIPS_DIR = path.join(DATA_DIR, 'payslips');

// Verify qpdf is available before attempting any protection.
async function assertQpdf() {
  try {
    await execFileAsync('qpdf', ['--version']);
  } catch {
    throw new Error('qpdf is not installed or not in PATH. PDF protection is unavailable.');
  }
}

// Clean a ZIP entry name into a safe, usable on-disk filename instead of rejecting it.
// Handles real-world payslip names: accents (José), parens, apostrophes, commas, spaces.
// path.basename strips any directory components first (no traversal).
function sanitizePdfName(entryName) {
  let base = path.basename(entryName);
  base = base.normalize('NFKD').replace(/[\u0300-\u036f]/g, ''); // strip accents: Jose
  base = base.replace(/[\x00-\x1f\x7f]/g, '');                    // drop control chars
  base = base.replace(/[\\/:*?"<>|]/g, '_');                      // swap filesystem-hostile chars
  base = base.replace(/^[.\s]+/, '').trim();                      // no leading dots/space (hidden/traversal)
  base = base.replace(/\s+/g, ' ');                               // collapse whitespace
  return base;
}

export function parseExcel(buffer) {
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });

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

const ZIP_UNREADABLE = 'Could not read the ZIP file — it may be corrupted, truncated, or an unsupported format.';

// Extract PDFs from a ZIP using yauzl (streaming): handles zip64/large archives that
// adm-zip silently fails on, and throws a clear error on corruption/truncation instead
// of returning nothing. Async — callers must await.
export function extractZip(buffer, destFolder) {
  fs.mkdirSync(destFolder, { recursive: true });
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(buffer, { lazyEntries: true }, (err, zipfile) => {
      if (err || !zipfile) return reject(new Error(ZIP_UNREADABLE));

      const extracted = [];
      const seen = new Set();
      let totalBytes = 0;
      let settled = false;
      const diag = { entries: 0, dirs: 0, nonPdf: 0, emptyName: 0, exts: {}, samples: [] };
      const fail = (e) => { if (!settled) { settled = true; reject(e); } };

      zipfile.on('error', () => fail(new Error(ZIP_UNREADABLE)));

      zipfile.on('entry', (entry) => {
        if (settled) return;
        diag.entries++;
        const name = entry.fileName;
        if (diag.samples.length < 5) diag.samples.push(name);

        if (/\/$/.test(name)) { diag.dirs++; return zipfile.readEntry(); } // directory entry
        const ext = path.extname(name).toLowerCase();
        diag.exts[ext] = (diag.exts[ext] || 0) + 1;
        if (ext !== '.pdf') { diag.nonPdf++; return zipfile.readEntry(); }

        const safeName = sanitizePdfName(name);
        if (!safeName || safeName.toLowerCase() === '.pdf') { diag.emptyName++; return zipfile.readEntry(); }
        const key = safeName.toLowerCase();
        if (seen.has(key)) return fail(new Error(`Duplicate PDF filename in ZIP: ${safeName}`));

        const declaredSize = entry.uncompressedSize || 0;
        if (declaredSize > MAX_FILE_BYTES) return fail(new Error(`File too large: ${safeName} (> ${Math.round(MAX_FILE_BYTES / 1024 / 1024)} MB)`));
        if (totalBytes + declaredSize > MAX_UNZIPPED_BYTES) return fail(new Error('ZIP too large: total uncompressed size exceeds 200 MB.'));
        if (extracted.length + 1 > MAX_FILES) return fail(new Error(`ZIP has too many files (>${MAX_FILES}).`));
        seen.add(key);

        zipfile.openReadStream(entry, (err2, stream) => {
          if (err2 || !stream) return fail(new Error(ZIP_UNREADABLE));
          const chunks = [];
          let size = 0;
          stream.on('data', (c) => {
            size += c.length;
            if (size > MAX_FILE_BYTES) { stream.destroy(); return fail(new Error(`File too large: ${safeName} (> ${Math.round(MAX_FILE_BYTES / 1024 / 1024)} MB)`)); }
            chunks.push(c);
          });
          stream.on('error', () => fail(new Error(ZIP_UNREADABLE)));
          stream.on('end', () => {
            if (settled) return;
            totalBytes += size;
            fs.writeFileSync(path.join(destFolder, safeName), Buffer.concat(chunks));
            extracted.push(safeName);
            zipfile.readEntry();
          });
        });
      });

      zipfile.on('end', () => {
        if (settled) return;
        settled = true;
        if (extracted.length === 0) console.error('[extractZip] 0 PDFs extracted — diag:', JSON.stringify(diag));
        resolve(extracted);
      });

      zipfile.readEntry();
    });
  });
}

export async function protectPdf(inputPath, outputPath, password) {
  try {
    await execFileAsync('qpdf', [
      '--encrypt', password, password, '256',
      '--',
      inputPath,
      outputPath
    ]);
  } catch {
    // Don't propagate qpdf's raw error — argv contains the password.
    // Remove any partial output file qpdf may have created before throwing.
    try { fs.unlinkSync(outputPath); } catch (e) { console.warn('[protectPdf] failed to remove partial output:', outputPath, e.message); }
    throw new Error('PDF protection failed (qpdf error).');
  }
}

const PREFLIGHT_BATCH_SIZE = 100;

/**
 * AI pre-flight check: review matches for suspicious pairings before sending.
 * Batches inputs so large payrolls don't exceed token limits.
 * Returns { issues, all_clear, summary, skipped? }
 */
export async function preflightCheck(results) {
  const apiKey = getAnthropicApiKey();
  if (!apiKey) return { issues: [], all_clear: true, skipped: true };

  const allIssues = [];
  let allClear = true;
  const summaries = [];

  for (let i = 0; i < results.length; i += PREFLIGHT_BATCH_SIZE) {
    const batch = results.slice(i, i + PREFLIGHT_BATCH_SIZE);
    const batchNum = Math.floor(i / PREFLIGHT_BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(results.length / PREFLIGHT_BATCH_SIZE);

    const prompt = `You are a payroll compliance reviewer doing a final pre-send check.${totalBatches > 1 ? ` (Batch ${batchNum} of ${totalBatches})` : ''}

Below are payslip file assignments — each employee is matched to a PDF file that will be password-protected with their NI number and emailed to them.

Assignments:
${JSON.stringify(batch.map((r) => ({ email: r.email, name: r.name, filename: r.filename, confidence: r.confidence })), null, 2)}

Review for potential errors:
- Does the filename plausibly correspond to the person's name?
- Are any matches flagged "low" confidence suspicious?
- Could any two assignments be swapped (i.e. wrong person gets wrong file)?
- Any duplicate filenames? Any obviously wrong pairings?

Be conservative: flag anything uncertain. A false alarm is cheaper than a wrong payslip.

Return ONLY a JSON object — no markdown, no explanation:
{"issues":[{"email":"...","name":"...","filename":"...","severity":"high|medium","message":"..."}],"all_clear":true|false,"summary":"one sentence"}

If no issues found: {"issues":[],"all_clear":true,"summary":"All assignments look correct."}`;

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 2048,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    if (!res.ok) throw new Error(`Claude API error ${res.status}`);

    const data = await res.json();
    const text = data.content?.[0]?.text || '';
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('Claude returned no JSON in pre-flight response.');
    let parsed;
    try {
      parsed = JSON.parse(jsonMatch[0]);
    } catch {
      throw new Error('Claude returned malformed JSON in pre-flight response.');
    }

    if (parsed.issues?.length) allIssues.push(...parsed.issues);
    if (!parsed.all_clear) allClear = false;
    if (parsed.summary) summaries.push(parsed.summary);
  }

  return {
    issues: allIssues,
    all_clear: allClear,
    summary: summaries.join(' ')
  };
}

/**
 * Full pipeline: parse Excel + extract ZIP → AI-match → protect each PDF.
 * NI numbers are used internally for protection and NEVER returned in results.
 */
export async function preparePayslips(xlsxBuffer, zipBuffer, apiKey) {
  await assertQpdf();

  // Collision-resistant run ID: timestamp + 4 random bytes
  const runId = Date.now().toString(36) + randomBytes(4).toString('hex');
  const rawDir = path.join(PAYSLIPS_DIR, runId, 'raw');
  const protectedDir = path.join(PAYSLIPS_DIR, runId, 'protected');
  fs.mkdirSync(rawDir, { recursive: true });
  fs.mkdirSync(protectedDir, { recursive: true });

  let extractionDone = false;
  const results = [];
  try {
    // 1. Parse recipients from Excel
    const recipients = parseExcel(xlsxBuffer);
    if (recipients.length === 0) throw new Error('No valid recipients found in Excel file.');

    // 2. Extract PDFs from ZIP
    const extractedFiles = await extractZip(zipBuffer, rawDir);
    if (extractedFiles.length === 0) throw new Error('No valid PDF files found in the uploaded ZIP.');
    extractionDone = true;

    // 3. Match filenames → recipients (AI + fuzzy)
    const { matched, unmatched, unmatched_files, ai_errors } = await matchAttachments(
      recipients.map((r) => ({ email: r.email, name: r.name })),
      rawDir,
      apiKey
    );

    const recipientMap = new Map(recipients.map((r) => [r.email.toLowerCase(), r]));

    // 4. Password-protect each matched PDF
    const protect_errors = [];

    for (const m of matched) {
      const rec = recipientMap.get(m.email.toLowerCase());
      if (!rec) continue;
      if (!rec.ni_no) {
        protect_errors.push({ email: m.email, error: 'Missing NI No — cannot set PDF password.' });
        continue;
      }
      const outName = path.basename(m.filename, '.pdf') + '_protected.pdf';
      const outPath = path.join(protectedDir, outName);
      try {
        await protectPdf(m.path, outPath, rec.ni_no);
        // NI No is NOT included in results — it's only used for protection above
        results.push({
          email: m.email,
          name: m.name,
          filename: outName,
          protected_path: outPath,
          confidence: m.confidence
        });
      } catch (err) {
        protect_errors.push({ email: m.email, error: err.message });
      }
    }

    return { results, unmatched, unmatched_files, protect_errors, ai_errors, run_id: runId };
  } finally {
    // Always delete raw (unprotected) PDFs once extraction is done — reduces PII on disk.
    // If extraction never started, clean up the empty run directory instead.
    if (extractionDone) {
      // If all protections failed, clean up empty protectedDir too
      if (results.length === 0) fs.rmSync(protectedDir, { recursive: true, force: true });
      fs.rmSync(rawDir, { recursive: true, force: true });
    } else {
      fs.rmSync(path.join(PAYSLIPS_DIR, runId), { recursive: true, force: true });
    }
  }
}

/**
 * Phase 1: parse Excel + extract ZIP → AI-match → save pending.json with NI nos.
 * Returns matches for admin review WITHOUT running qpdf.
 */
export async function prepareForReview(xlsxBuffer, zipBuffer, apiKey) {
  await assertQpdf();

  const runId = Date.now().toString(36) + randomBytes(4).toString('hex');
  const rawDir = path.join(PAYSLIPS_DIR, runId, 'raw');
  const protectedDir = path.join(PAYSLIPS_DIR, runId, 'protected');
  fs.mkdirSync(rawDir, { recursive: true });
  fs.mkdirSync(protectedDir, { recursive: true });

  try {
    const recipients = parseExcel(xlsxBuffer);
    if (!recipients.length) throw new Error('No valid recipients found in Excel file.');

    const extractedFiles = await extractZip(zipBuffer, rawDir);
    if (extractedFiles.length === 0) throw new Error('No valid PDF files found in the uploaded ZIP.');

    const { matched, unmatched, unmatched_files, ai_errors } = await matchAttachments(
      recipients.map((r) => ({ email: r.email, name: r.name })),
      rawDir,
      apiKey
    );

    const recipientMap = new Map(recipients.map((r) => [r.email.toLowerCase(), r]));
    const pending = [];
    const no_ni = [];

    for (const m of matched) {
      const rec = recipientMap.get(m.email.toLowerCase());
      if (!rec?.ni_no) { no_ni.push({ email: m.email, name: m.name }); continue; }
      pending.push({ email: m.email, name: m.name, ni_no: rec.ni_no, filename: m.filename, path: m.path, confidence: m.confidence });
    }

    // Persist pending state (includes NI nos — server-side only, deleted after confirm)
    const pendingFile = path.join(PAYSLIPS_DIR, runId, 'pending.json');
    fs.writeFileSync(pendingFile, JSON.stringify({ pending, unmatched, unmatched_files, ai_errors, no_ni }));

    return {
      run_id: runId,
      // NI nos returned here for admin spot-check UI (protected by APP_PASSWORD + IP restriction)
      pending: pending.map((p) => ({ email: p.email, name: p.name, ni_no: p.ni_no, filename: p.filename, confidence: p.confidence })),
      no_ni,
      unmatched,
      unmatched_files,
      ai_errors
    };
  } catch (err) {
    fs.rmSync(path.join(PAYSLIPS_DIR, runId), { recursive: true, force: true });
    throw err;
  }
}

/**
 * Phase 2: run qpdf on approved subset → save results.json.
 * approvedEmails: optional array — null means approve all pending.
 */
export async function confirmPayslips(runId, approvedEmails) {
  const runDir = path.join(PAYSLIPS_DIR, runId);
  const pendingFile = path.join(runDir, 'pending.json');
  if (!fs.existsSync(pendingFile)) throw new Error('No pending review found for this run. Please re-upload your files.');

  const { pending, unmatched, unmatched_files, ai_errors } = JSON.parse(fs.readFileSync(pendingFile, 'utf8'));

  const approvedSet = approvedEmails ? new Set(approvedEmails.map((e) => e.toLowerCase())) : null;
  const toProtect = approvedSet ? pending.filter((p) => approvedSet.has(p.email.toLowerCase())) : pending;
  if (!toProtect.length) throw new Error('No payslips selected for protection.');

  const protectedDir = path.join(runDir, 'protected');
  const rawDir = path.join(runDir, 'raw');
  const results = [];
  const protect_errors = [];

  for (const m of toProtect) {
    const outName = path.basename(m.filename, '.pdf') + '_protected.pdf';
    const outPath = path.join(protectedDir, outName);
    try {
      await protectPdf(m.path, outPath, m.ni_no);
      results.push({ email: m.email, name: m.name, filename: outName, protected_path: outPath, confidence: m.confidence });
    } catch (err) {
      protect_errors.push({ email: m.email, error: err.message });
    }
  }

  fs.rmSync(rawDir, { recursive: true, force: true });
  try { fs.unlinkSync(pendingFile); } catch { /* ignore */ }

  if (!results.length) {
    fs.rmSync(protectedDir, { recursive: true, force: true });
    throw new Error('All PDF protections failed. Check qpdf is installed correctly.');
  }

  const runName = new Date().toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const outcome = { results, unmatched, unmatched_files, protect_errors, ai_errors: ai_errors || [], run_id: runId, name: runName };
  fs.writeFileSync(path.join(runDir, 'results.json'), JSON.stringify(outcome));
  return outcome;
}

// ---- Run management ----

export function listRuns() {
  if (!fs.existsSync(PAYSLIPS_DIR)) return [];
  return fs.readdirSync(PAYSLIPS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => {
      const runPath = path.join(PAYSLIPS_DIR, d.name);
      const resultFile = path.join(runPath, 'results.json');
      let created = null;
      let recipient_count = 0;
      let name = null;
      try {
        const stat = fs.statSync(resultFile);
        created = stat.mtime.toISOString();
        const data = JSON.parse(fs.readFileSync(resultFile, 'utf8'));
        recipient_count = data.results?.length || 0;
        name = data.name || null;
      } catch { /* ignore */ }
      return { run_id: d.name, created, recipient_count, name };
    })
    .sort((a, b) => (b.created || '').localeCompare(a.created || ''));
}

export function deleteRun(runId) {
  if (!/^[a-z0-9]+$/.test(runId)) throw new Error('Invalid run_id.');
  const runPath = path.join(PAYSLIPS_DIR, runId);
  const resolved = path.resolve(runPath);
  if (!resolved.startsWith(path.resolve(PAYSLIPS_DIR) + path.sep)) throw new Error('Invalid run_id.');
  // Use force:false so ENOENT bubbles up as "not found" rather than silently succeeding.
  try {
    fs.rmSync(runPath, { recursive: true, force: false });
  } catch (err) {
    if (err.code === 'ENOENT') throw new Error('Run not found.');
    throw err;
  }
}

export function deleteAllRuns() {
  if (!fs.existsSync(PAYSLIPS_DIR)) return 0;
  const runs = fs.readdirSync(PAYSLIPS_DIR, { withFileTypes: true }).filter((d) => d.isDirectory());
  for (const d of runs) {
    fs.rmSync(path.join(PAYSLIPS_DIR, d.name), { recursive: true, force: true });
  }
  return runs.length;
}
