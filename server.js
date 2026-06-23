import express from 'express';
import multer from 'multer';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { UPLOAD_DIR } from './src/db.js';
import { getPublicSettings, updateSettings, seedFromEnv } from './src/settings.js';
import { sendTest, buildTransport, sendOne, fromHeaderFor } from './src/mailer.js';
import { parseRecipients } from './src/parseRecipients.js';
import {
  createCampaign, listCampaigns, getCampaign, setStatus,
  campaignStats, failedRecipients, deleteCampaign, requeueFailed, firstRecipient
} from './src/campaigns.js';
import { startWorker, stopWorker } from './src/worker.js';
import { preparePayslips, prepareForReview, confirmPayslips, preflightCheck, listRuns, deleteRun, deleteAllRuns, PAYSLIPS_DIR } from './src/preparePayslips.js';
import { getAnthropicApiKey } from './src/settings.js';
import XLSX from 'xlsx';
import { Worker } from 'node:worker_threads';
import { toSqlTime } from './src/time.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const APP_PASSWORD = process.env.APP_PASSWORD || '';

seedFromEnv();

const app = express();
app.use(express.json());

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }, // Gmail's 25MB attachment ceiling
  fileFilter(_req, file, cb) {
    const allowed = ['application/pdf', 'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'text/csv', 'text/plain', 'image/png', 'image/jpeg'];
    cb(null, allowed.includes(file.mimetype));
  }
});

// ---- Optional password gate (recommended when hosting on a public server) ----
app.get('/api/config', (req, res) => {
  res.json({ authRequired: !!APP_PASSWORD });
});

// Constant-time compare so the password can't be guessed byte-by-byte via timing.
function passwordMatches(supplied) {
  const a = Buffer.from(String(supplied || ''));
  const b = Buffer.from(APP_PASSWORD);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Lightweight per-IP throttle to blunt brute-force attempts.
const failedAttempts = new Map(); // ip -> { count, until, last }
const FAILED_TTL_MS = 10 * 60 * 1000;

// Sweep entries whose lockout window has expired so the map doesn't grow forever.
function sweepFailedAttempts() {
  const now = Date.now();
  for (const [ip, rec] of failedAttempts) {
    if ((rec.until > 0 && rec.until <= now) || (rec.last && rec.last + FAILED_TTL_MS <= now)) {
      failedAttempts.delete(ip);
    }
  }
}
setInterval(sweepFailedAttempts, 5 * 60 * 1000).unref();

app.use('/api', (req, res, next) => {
  if (!APP_PASSWORD || req.path === '/config' || req.path === '/payslips/sample-excel') return next();
  const ip = req.ip || 'unknown';
  const rec = failedAttempts.get(ip);
  if (rec && rec.until > Date.now()) {
    return res.status(429).json({ error: 'Too many attempts. Wait a minute and try again.' });
  }
  const supplied = req.get('x-app-password');
  if (passwordMatches(supplied)) {
    // Clear the lockout window but keep the count so the IP doesn't reset its budget
    const existing = failedAttempts.get(ip);
    if (existing) failedAttempts.set(ip, { count: existing.count, until: 0, last: Date.now() });
    return next();
  }
  // Only count as a failed attempt when a password was explicitly supplied but wrong.
  // Missing header = unauthenticated page load — don't penalise the IP (multiple users
  // on the same office NAT would otherwise exhaust each other's attempt budget).
  if (supplied) {
    const count = (rec?.count || 0) + 1;
    failedAttempts.set(ip, { count, until: count >= 5 ? Date.now() + 60_000 : 0, last: Date.now() });
  }
  res.status(401).json({ error: 'Unauthorized' });
});

// Wrap a handler so BOTH synchronous throws and rejected promises become a clean
// JSON error response (Promise.resolve(fn()) would miss a synchronous throw inside fn).
const wrap = (fn) => (req, res) => Promise.resolve().then(() => fn(req, res)).catch((err) => {
  console.error(err.message, err.code || '');
  if (res.headersSent) return;
  // Only expose messages from errors our code explicitly threw.
  // System errors (.code), SQLite errors, and library internals get a generic response.
  const isSafe = !err.code && !/SQLITE_|node_modules|\/app\/|\\app\\/.test(err.message || '');
  const status = err.status || (isSafe && err.message?.includes('not found') ? 404 : isSafe ? 400 : 500);
  res.status(status).json({ error: isSafe ? err.message : 'An internal error occurred.' });
});

// ---- Settings ----
app.get('/api/settings', wrap((req, res) => res.json(getPublicSettings())));

app.post('/api/settings', wrap((req, res) => res.json(updateSettings(req.body))));

app.post('/api/settings/test', wrap(async (req, res) => {
  const to = (req.body.to || '').trim();
  if (!to) throw new Error('Please provide an email address to send the test to.');
  await sendTest(to);
  res.json({ ok: true });
}));

// ---- Campaigns ----
app.get('/api/campaigns', wrap((req, res) => res.json(listCampaigns())));

app.get('/api/campaigns/:id', wrap((req, res) => {
  const c = getCampaign(Number(req.params.id));
  if (!c) throw new Error('Campaign not found.');
  res.json({ ...c, stats: campaignStats(c.id), failures: failedRecipients(c.id) });
}));

app.post('/api/campaigns', upload.fields([
  { name: 'recipients', maxCount: 1 },
  { name: 'attachment', maxCount: 1 }
]), wrap((req, res) => {
  const b = req.body;
  const csvFile = req.files?.recipients?.[0];
  const attachFile = req.files?.attachment?.[0];

  if (!b.name?.trim()) throw new Error('Please give the campaign a name.');
  if (!b.subject?.trim()) throw new Error('Please enter a subject line.');
  if (!b.body?.trim()) throw new Error('Please write the email body.');

  const offset = (() => {
    const raw = b.scheduled_timezone_offset_minutes ?? b.scheduled_tz_offset ?? req.get('x-timezone-offset');
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  })();
  const scheduled = b.scheduled_start?.trim() ? toSqlTime(b.scheduled_start, offset) : null;
  const asDraft = b.as_draft === 'true' || b.as_draft === true;
  const status = asDraft ? 'draft' : (scheduled ? 'scheduled' : 'running');
  const base = {
    name: b.name.trim(), subject: b.subject.trim(), body: b.body,
    from_name: (b.from_name || '').trim(), from_email: (b.from_email || '').trim(),
    batch_size: Math.max(1, intField(b.batch_size, 10)),
    batch_interval_seconds: Math.max(0, intField(b.batch_interval_seconds, 60)),
    scheduled_start: scheduled, status
  };

  // Payslips run mode — per-recipient password-protected PDFs
  if (b.run_id) {
    const outcome = loadRunResults(b.run_id);
    if (!outcome.results?.length) throw new Error('No prepared payslips found in that run.');
    const recipients = outcome.results.map((r) => ({
      email: r.email, name: r.name,
      attachment_path: r.protected_path,
      fields_json: JSON.stringify({ name: r.name, email: r.email, filename: r.filename })
    }));
    const id = createCampaign({ ...base, attachment_path: null, attachment_name: null }, recipients);
    return res.json({ id, accepted: recipients.length, skipped: [] });
  }

  // Normal mode — CSV + optional shared attachment
  if (!csvFile) throw new Error('Please upload a recipients CSV file.');
  const { recipients, errors } = parseRecipients(csvFile.buffer);
  if (recipients.length === 0) {
    throw new Error('No valid recipients found. ' + (errors[0] || ''));
  }

  let attachment_path = null;
  let attachment_name = null;
  if (attachFile) {
    const safe = attachFile.originalname.replace(/[^\w.\-]+/g, '_');
    const stored = `${Date.now()}_${crypto.randomBytes(6).toString('hex')}_${safe}`;
    attachment_path = path.join(UPLOAD_DIR, stored);
    fs.writeFileSync(attachment_path, attachFile.buffer);
    attachment_name = attachFile.originalname;
  }

  const id = createCampaign({ ...base, attachment_path, attachment_name }, recipients);
  res.json({ id, accepted: recipients.length, skipped: errors });
}));

const guard = (id) => { const c = getCampaign(id); if (!c) throw new Error('Campaign not found.'); return c; };

app.post('/api/campaigns/:id/start', wrap((req, res) => {
  const c = guard(Number(req.params.id));
  const future = c.scheduled_start && new Date(c.scheduled_start.replace(' ', 'T') + 'Z') > new Date();
  const status = future ? 'scheduled' : 'running';
  setStatus(c.id, status, { next_batch_at: null });
  res.json({ ok: true, status });
}));

app.post('/api/campaigns/:id/pause', wrap((req, res) => {
  guard(Number(req.params.id));
  setStatus(Number(req.params.id), 'paused');
  res.json({ ok: true });
}));

app.post('/api/campaigns/:id/resume', wrap((req, res) => {
  const c = guard(Number(req.params.id));
  // If a future start time is still set, resume back into 'scheduled' rather than
  // firing immediately — pausing a scheduled campaign must not lose its schedule.
  const future = c.scheduled_start && new Date(c.scheduled_start.replace(' ', 'T') + 'Z') > new Date();
  const status = future ? 'scheduled' : 'running';
  setStatus(c.id, status, { next_batch_at: null });
  res.json({ ok: true, status });
}));

app.post('/api/campaigns/:id/cancel', wrap((req, res) => {
  guard(Number(req.params.id));
  setStatus(Number(req.params.id), 'cancelled');
  res.json({ ok: true });
}));

app.post('/api/campaigns/:id/requeue-failed', wrap((req, res) => {
  const c = guard(Number(req.params.id));
  const changes = requeueFailed(c.id);
  // 'cancelled' is terminal — don't silently revive a send the operator stopped.
  if (changes > 0 && ['completed', 'paused'].includes(c.status)) {
    setStatus(c.id, 'running', { next_batch_at: null });
  }
  res.json({ ok: true, requeued: changes });
}));

// Send a real preview of THIS campaign (rendered subject/body + attachment) to one
// address, using the first recipient's data as the sample so {placeholders} are realistic.
app.post('/api/campaigns/:id/test', wrap(async (req, res) => {
  const c = guard(Number(req.params.id));
  const to = (req.body.to || '').trim();
  if (!to) throw new Error('Please provide an email address for the preview.');
  const sample = firstRecipient(c.id) || { name: 'Sample Name', email: to, fields_json: '{}' };
  const transport = buildTransport();
  try {
    await transport.verify();
    await sendOne(transport, c, sample, fromHeaderFor(c), to);
  } finally {
    try { transport.close(); } catch { /* ignore */ }
  }
  res.json({ ok: true });
}));

app.delete('/api/campaigns/:id', wrap((req, res) => {
  const c = getCampaign(Number(req.params.id));
  if (!c) { const e = new Error('Campaign not found.'); e.status = 404; throw e; }
  deleteCampaign(c.id); // DB first — if this throws, file is untouched
  if (c.attachment_path) {
    try { fs.unlinkSync(c.attachment_path); } catch { /* ignore */ }
  }
  res.json({ ok: true });
}));

// Parse an integer field, keeping a deliberate 0 (unlike `Number(x) || default`).
function intField(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

// ---- Payslips ----
const payslipsUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 300 * 1024 * 1024 }, // large payslip ZIPs (150+ PDFs) exceeded the old 100MB cap
  fileFilter(_req, file, cb) {
    // SheetJS (XLSX.read) parses xlsx/xls/xlsm/xlsb/ods/csv — accept any spreadsheet type.
    // Browsers send inconsistent mimetypes, so fall back to extension when the type is generic.
    const excelExts = ['.xlsx', '.xls', '.xlsm', '.xlsb', '.ods', '.csv'];
    const allowed = {
      excel: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
               'application/vnd.ms-excel',
               'application/vnd.ms-excel.sheet.macroenabled.12',
               'application/vnd.openxmlformats-officedocument.spreadsheetml.template',
               'application/vnd.oasis.opendocument.spreadsheet',
               'text/csv', 'application/csv', 'application/octet-stream', ''],
      zip: ['application/zip', 'application/x-zip-compressed', 'application/octet-stream']
    };
    const permitted = allowed[file.fieldname] || [];
    const extOk = file.fieldname === 'excel'
      && excelExts.includes(path.extname(file.originalname || '').toLowerCase());
    cb(null, permitted.includes(file.mimetype) || extOk);
  }
});

// Validate run_id: server-generated base36 timestamp, no path traversal possible
function assertRunId(run_id) {
  if (!run_id || !/^[a-z0-9]+$/.test(run_id)) throw new Error('Invalid run_id.');
  const resolved = path.resolve(path.join(PAYSLIPS_DIR, run_id));
  if (!resolved.startsWith(path.resolve(PAYSLIPS_DIR) + path.sep)) throw new Error('Invalid run_id.');
  return resolved;
}

// Load results.json for a run; throws if missing or corrupt.
function loadRunResults(run_id) {
  const runDir = assertRunId(run_id);
  const resultFile = path.join(runDir, 'results.json');
  try {
    return JSON.parse(fs.readFileSync(resultFile, 'utf8'));
  } catch {
    throw new Error('Prepared run not found or corrupted. Please re-upload files.');
  }
}

// Run the heavy payslip preparation pipeline off the main thread so long jobs don't block
// the event loop. Returns the pipeline outcome or throws if the worker fails.
function runPayslipJob(excelBuffer, zipBuffer, apiKey) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./src/payslipJobWorker.js', import.meta.url), {
      workerData: { excel: excelBuffer, zip: zipBuffer, apiKey }
    });

    const timeout = setTimeout(() => {
      worker.terminate().catch(() => {});
      reject(new Error('Payslip preparation timed out. Please try a smaller batch.'));
    }, 120_000); // 2 minutes

    worker.once('message', (msg) => {
      clearTimeout(timeout);
      if (msg?.ok) return resolve(msg.result);
      reject(new Error(msg?.error || 'Payslip preparation failed.'));
    });

    worker.once('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });

    worker.once('exit', (code) => {
      if (code !== 0) reject(new Error('Payslip preparation worker exited unexpectedly.'));
    });
  });
}

// Step 1: Upload Excel + ZIP → AI-match only. Returns pending matches for admin review.
// PDF protection does NOT happen here — call /confirm after reviewing.
app.post('/api/payslips/prepare', payslipsUpload.fields([
  { name: 'excel', maxCount: 1 },
  { name: 'zip', maxCount: 1 }
]), wrap(async (req, res) => {
  const excelFile = req.files?.excel?.[0];
  const zipFile = req.files?.zip?.[0];
  if (!excelFile) throw new Error('Please upload the Excel file (employees).');
  if (!zipFile) throw new Error('Please upload the ZIP file (PDFs).');

  const apiKey = getAnthropicApiKey();
  const outcome = await runPayslipJob(excelFile.buffer, zipFile.buffer, apiKey);

  res.json({
    run_id: outcome.run_id,
    pending: outcome.pending,   // includes ni_no for admin spot-check
    no_ni: outcome.no_ni,
    unmatched: outcome.unmatched,
    unmatched_files: outcome.unmatched_files,
    ai_errors: outcome.ai_errors
  });
}));

// Step 1b: Confirm reviewed matches → run qpdf → save results.json.
app.post('/api/payslips/:runId/confirm', wrap(async (req, res) => {
  const { runId } = req.params;
  assertRunId(runId);
  const { approved_emails } = req.body;
  const outcome = await confirmPayslips(runId, approved_emails || null);
  res.json({
    run_id: outcome.run_id,
    protected_count: outcome.results.length,
    protect_errors: outcome.protect_errors,
    name: outcome.name
  });
}));

// Step 1b: AI pre-flight check on a prepared run.
app.post('/api/payslips/preflight', wrap(async (req, res) => {
  const { run_id } = req.body;
  if (!run_id) throw new Error('Missing run_id.');
  const outcome = loadRunResults(run_id);
  if (!outcome.results?.length) throw new Error('No matched payslips to check.');
  const result = await preflightCheck(outcome.results);
  res.json(result);
}));

// Step 2: Create a campaign from a prepared payslips run (per-recipient attachments).
app.post('/api/payslips/send', wrap((req, res) => {
  const { run_id, name, subject, body, from_name, from_email, batch_size, batch_interval_seconds, as_draft } = req.body;
  if (!run_id) throw new Error('Missing run_id.');
  if (!name?.trim()) throw new Error('Please give the campaign a name.');
  if (!subject?.trim()) throw new Error('Please enter a subject line.');
  if (!body?.trim()) throw new Error('Please write the email body.');

  const outcome = loadRunResults(run_id);
  if (!outcome.results?.length) throw new Error('No successfully prepared payslips in this run.');

  const recipients = outcome.results.map((r) => ({
    email: r.email,
    name: r.name,
    attachment_path: r.protected_path,
    fields_json: JSON.stringify({ name: r.name, email: r.email, filename: r.filename })
  }));

  const status = (as_draft === 'true' || as_draft === true) ? 'draft' : 'running';
  const id = createCampaign({
    name: name.trim(),
    subject: subject.trim(),
    body,
    from_name: (from_name || '').trim(),
    from_email: (from_email || '').trim(),
    attachment_path: null,
    attachment_name: null,
    batch_size: Math.max(1, intField(batch_size, 10)),
    batch_interval_seconds: Math.max(0, intField(batch_interval_seconds, 60)),
    scheduled_start: null,
    status
  }, recipients);

  res.json({ id, accepted: recipients.length });
}));

// Sample Excel download — returns a template .xlsx with the required columns
app.get('/api/payslips/sample-excel', (_req, res) => {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([
    ['EENo', 'FullName', 'NI No', 'Email Address'],
    ['E001', 'Alice Smith',  'AB123456C', 'alice.smith@example.com'],
    ['E002', 'Bob Jones',    'CD234567D', 'bob.jones@example.com'],
    ['E003', 'Carol White',  'EF345678E', 'carol.white@example.com'],
  ]);
  XLSX.utils.book_append_sheet(wb, ws, 'Employees');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="sample-employees.xlsx"');
  res.send(buf);
});

// Run management — list, delete one, delete all
app.get('/api/payslips/runs', wrap((req, res) => res.json(listRuns())));

app.delete('/api/payslips/runs/all', wrap((req, res) => {
  const count = deleteAllRuns();
  res.json({ ok: true, deleted: count });
}));

app.delete('/api/payslips/runs/:runId', wrap((req, res) => {
  deleteRun(req.params.runId);
  res.json({ ok: true });
}));

app.use(express.static(path.join(__dirname, 'public')));

const server = app.listen(PORT, () => {
  console.log(`Payroll Mail Service listening on http://localhost:${PORT}`);
  if (APP_PASSWORD) console.log('Password protection is ENABLED.')
  else console.warn('WARNING: APP_PASSWORD is not set — the API is unprotected. Set APP_PASSWORD in production.')
  startWorker();
});

// Finish any in-flight batch before exiting so a shutdown doesn't interrupt a send.
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, async () => {
    console.log(`\n${signal} received — finishing in-flight batch, then shutting down…`);
    try { await stopWorker(); } catch { /* ignore */ }
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000).unref();
  });
}
