import express from 'express';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { UPLOAD_DIR } from './src/db.js';
import { getPublicSettings, updateSettings, seedFromEnv } from './src/settings.js';
import { sendTest } from './src/mailer.js';
import { parseRecipients } from './src/parseRecipients.js';
import {
  createCampaign, listCampaigns, getCampaign, setStatus,
  campaignStats, failedRecipients, deleteCampaign, requeueFailed
} from './src/campaigns.js';
import { startWorker } from './src/worker.js';

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

app.use('/api', (req, res, next) => {
  if (!APP_PASSWORD || req.path === '/config') return next();
  if (req.get('x-app-password') === APP_PASSWORD) return next();
  res.status(401).json({ error: 'Unauthorized' });
});

const wrap = (fn) => (req, res) => Promise.resolve(fn(req, res)).catch((err) => {
  console.error(err);
  res.status(400).json({ error: err.message });
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
    batch_size: Math.max(1, Number(b.batch_size) || 10),
    batch_interval_seconds: Math.max(0, Number(b.batch_interval_seconds) || 60),
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
  guard(Number(req.params.id));
  setStatus(Number(req.params.id), 'running', { next_batch_at: null });
  res.json({ ok: true });
}));

app.post('/api/campaigns/:id/cancel', wrap((req, res) => {
  guard(Number(req.params.id));
  setStatus(Number(req.params.id), 'cancelled');
  res.json({ ok: true });
}));

app.post('/api/campaigns/:id/requeue-failed', wrap((req, res) => {
  const c = guard(Number(req.params.id));
  const changes = requeueFailed(c.id);
  if (changes > 0 && ['completed', 'cancelled', 'paused'].includes(c.status)) {
    setStatus(c.id, 'running', { next_batch_at: null });
  }
  res.json({ ok: true, requeued: changes });
}));

app.post('/api/campaigns/:id/test', wrap(async (req, res) => {
  guard(Number(req.params.id));
  const to = (req.body.to || '').trim();
  if (!to) throw new Error('Please provide an email address for the test.');
  // Reuse the generic connection test so the operator can preview deliverability.
  await sendTest(to);
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

app.use(express.static(path.join(__dirname, 'public')));

app.listen(PORT, () => {
  console.log(`Payroll Mail Service listening on http://localhost:${PORT}`);
  if (APP_PASSWORD) console.log('Password protection is ENABLED.');
  startWorker();
});
