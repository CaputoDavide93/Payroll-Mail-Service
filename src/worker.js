import db from './db.js';
import { getSettings } from './settings.js';
import { buildTransport, sendOne, fromHeaderFor } from './mailer.js';
import { campaignStats, setStatus } from './campaigns.js';

const TICK_MS = 2000;       // how often the worker wakes up
const MAX_ATTEMPTS = 3;     // per-recipient retries before marking failed
const RETRY_BACKOFF_MS = 1500;

let running = false;   // re-entrancy guard so ticks never overlap
let stopping = false;  // set on shutdown so no new tick begins
let intervalId = null;

const log = (...args) => console.log(new Date().toISOString(), '[worker]', ...args);

const currentStatusStmt = db.prepare('SELECT status FROM campaigns WHERE id = ?');

// How many emails were sent in the last 24h (across all campaigns) — for the daily cap.
const sentLast24hStmt = db.prepare(
  "SELECT COUNT(*) AS n FROM recipients WHERE sent_at IS NOT NULL AND sent_at >= datetime('now', '-1 day')"
);
function sentLast24h() {
  return sentLast24hStmt.get().n;
}

const dueScheduledStmt = db.prepare(
  "SELECT id FROM campaigns WHERE status = 'scheduled' AND (scheduled_start IS NULL OR scheduled_start <= datetime('now'))"
);

// Pick the oldest running campaign that isn't waiting out its between-batch interval.
const nextRunnableStmt = db.prepare(
  "SELECT * FROM campaigns WHERE status = 'running' AND (next_batch_at IS NULL OR next_batch_at <= datetime('now')) ORDER BY id LIMIT 1"
);

const pendingBatchStmt = db.prepare(
  "SELECT * FROM recipients WHERE campaign_id = ? AND status = 'pending' ORDER BY id LIMIT ?"
);

const markSentStmt = db.prepare(
  "UPDATE recipients SET status='sent', sent_at=datetime('now'), attempts=attempts+1, error=NULL WHERE id = ?"
);
const markFailedStmt = db.prepare(
  "UPDATE recipients SET status='failed', attempts=attempts+1, error=? WHERE id = ?"
);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function trySend(transport, campaign, recipient, fromHeader) {
  let lastErr;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      await sendOne(transport, campaign, recipient, fromHeader);
      return { ok: true };
    } catch (err) {
      lastErr = err;
      log(`send failed (attempt ${attempt}/${MAX_ATTEMPTS}) to ${recipient.email}: ${err.message}`);
      if (attempt < MAX_ATTEMPTS) await sleep(RETRY_BACKOFF_MS * attempt);
    }
  }
  return { ok: false, error: lastErr?.message || 'unknown error' };
}

async function tick() {
  if (running || stopping) return;
  running = true;
  let transport;
  try {
    const settings = getSettings();
    if (!settings.smtp_host || !settings.smtp_user || !settings.smtp_pass) return;

    // 1) Promote any scheduled campaigns whose start time has arrived.
    for (const { id } of dueScheduledStmt.all()) {
      setStatus(id, 'running', { next_batch_at: null });
      log(`campaign ${id} started (scheduled time reached)`);
    }

    // 2) Pick one running campaign that's ready for its next batch.
    const campaign = nextRunnableStmt.get();
    if (!campaign) return;

    // 3) Daily cap guard — pause sending for this tick if we've hit the limit.
    const remainingToday = settings.daily_limit - sentLast24h();
    if (remainingToday <= 0) {
      log(`daily limit of ${settings.daily_limit} reached; waiting before sending more`);
      setStatus(campaign.id, 'running', { next_batch_at: isoIn(15 * 60) });
      return;
    }

    const batchSize = Math.min(campaign.batch_size, remainingToday);
    const batch = pendingBatchStmt.all(campaign.id, batchSize);

    if (batch.length === 0) {
      const stats = campaignStats(campaign.id);
      setStatus(campaign.id, 'completed', { next_batch_at: null });
      log(`campaign ${campaign.id} completed — sent ${stats.sent}, failed ${stats.failed}`);
      return;
    }

    transport = buildTransport();
    const fromHeader = fromHeaderFor(campaign);
    log(`campaign ${campaign.id}: sending batch of ${batch.length}`);

    for (const recipient of batch) {
      const result = await trySend(transport, campaign, recipient, fromHeader);
      if (result.ok) markSentStmt.run(recipient.id);
      else markFailedStmt.run(result.error, recipient.id);
    }

    // 4) Schedule the next batch — but only if the operator didn't pause/cancel
    // during the (potentially long) send loop above. Re-read the live status so
    // we never resurrect a campaign the operator explicitly stopped.
    const fresh = currentStatusStmt.get(campaign.id);
    if (fresh && fresh.status === 'running') {
      setStatus(campaign.id, 'running', { next_batch_at: isoIn(campaign.batch_interval_seconds) });
    }
  } catch (err) {
    log('tick error:', err.message);
  } finally {
    if (transport) { try { transport.close(); } catch { /* ignore */ } }
    running = false;
  }
}

function isoIn(seconds) {
  return new Date(Date.now() + seconds * 1000).toISOString().replace('T', ' ').slice(0, 19);
}

export function startWorker() {
  // Nothing special needed to "resume" after a restart: running campaigns are read
  // straight from the DB on the next tick, so progress continues automatically.
  log('background worker started');
  intervalId = setInterval(() => { tick().catch((e) => log('unhandled tick error', e)); }, TICK_MS);
}

// Stop accepting new batches and wait for any in-flight batch to finish, so a
// shutdown doesn't kill a send mid-flight (which would re-send on restart).
export async function stopWorker() {
  stopping = true;
  if (intervalId) clearInterval(intervalId);
  const deadline = Date.now() + 30000;
  while (running && Date.now() < deadline) await sleep(100);
}
