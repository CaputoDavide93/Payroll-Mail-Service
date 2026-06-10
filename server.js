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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const APP_PASSWORD = process.env.APP_PASSWORD || '';

seedFromEnv();

const app = express();
app.use(express.json());

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 } // Gmail's 25MB attachment ceiling
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
const failedAttempts = new Map(); // ip -> { count, until }
app.use('/api', (req, res, next) => {
  if (!APP_PASSWORD || req.path === '/config') return next();
  const ip = req.ip || 'unknown';
  const rec = failedAttempts.get(ip);
  if (rec && rec.until > Date.now()) {
    return res.status(429).json({ error: 'Too many attempts. Wait a minute and try again.' });
  }
  if (passwordMatches(req.get('x-app-password'))) {
    failedAttempts.delete(ip);
    return next();
  }
  const count = (rec?.count || 0) + 1;
  failedAttempts.set(ip, { count, until: count >= 5 ? Date.now() + 60_000 : 0 });
  res.status(401).json({ error: 'Unauthorized' });
});

// Wrap a handler so BOTH synchronous throws and rejected promises become a clean
// JSON 400 (Promise.resolve(fn()) would miss a synchronous throw inside fn).
const wrap = (fn) => (req, res) => Promise.resolve().then(() => fn(req, res)).catch((err) => {
  console.error(err);
  if (!res.headersSent) res.status(400).json({ error: err.message });
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
  if (!csvFile) throw new Error('Please upload a recipients CSV file.');

  const { recipients, errors } = parseRecipients(csvFile.buffer);
  if (recipients.length === 0) {
    throw new Error('No valid recipients found. ' + (errors[0] || ''));
  }

  let attachment_path = null;
  let attachment_name = null;
  if (attachFile) {
    const safe = attachFile.originalname.replace(/[^\w.\-]+/g, '_');
    const stored = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}_${safe}`;
    attachment_path = path.join(UPLOAD_DIR, stored);
    fs.writeFileSync(attachment_path, attachFile.buffer);
    attachment_name = attachFile.originalname;
  }

  const scheduled = b.scheduled_start?.trim() ? toSqlTime(b.scheduled_start) : null;
  const asDraft = b.as_draft === 'true' || b.as_draft === true;
  const status = asDraft ? 'draft' : (scheduled ? 'scheduled' : 'running');

  const id = createCampaign({
    name: b.name.trim(),
    subject: b.subject.trim(),
    body: b.body,
    from_name: (b.from_name || '').trim(),
    from_email: (b.from_email || '').trim(),
    attachment_path,
    attachment_name,
    batch_size: Math.max(1, intField(b.batch_size, 10)),
    batch_interval_seconds: Math.max(0, intField(b.batch_interval_seconds, 60)),
    scheduled_start: scheduled,
    status
  }, recipients);

  res.json({ id, accepted: recipients.length, skipped: errors });
}));

const guard = (id) => { const c = getCampaign(id); if (!c) throw new Error('Campaign not found.'); return c; };

app.post('/api/campaigns/:id/start', wrap((req, res) => {
  const c = guard(Number(req.params.id));
  const status = c.scheduled_start ? 'scheduled' : 'running';
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
  if (c?.attachment_path && fs.existsSync(c.attachment_path)) {
    try { fs.unlinkSync(c.attachment_path); } catch { /* ignore */ }
  }
  deleteCampaign(Number(req.params.id));
  res.json({ ok: true });
}));

// Convert an <input type="datetime-local"> value to "YYYY-MM-DD HH:MM:SS" (UTC for SQLite).
function toSqlTime(local) {
  const d = new Date(local);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().replace('T', ' ').slice(0, 19);
}

// Parse an integer field, keeping a deliberate 0 (unlike `Number(x) || default`).
function intField(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

app.use(express.static(path.join(__dirname, 'public')));

const server = app.listen(PORT, () => {
  console.log(`Payroll Mail Service listening on http://localhost:${PORT}`);
  if (APP_PASSWORD) console.log('Password protection is ENABLED.');
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
