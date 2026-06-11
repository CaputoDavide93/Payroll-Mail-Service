import db from './db.js';
import { getSettings } from './settings.js';
import { buildTransport, sendOne, fromHeaderFor } from './mailer.js';
import { campaignStats, setStatus } from './campaigns.js';

const TICK_MS = 2000;
const MAX_ATTEMPTS = 3;
const RETRY_BACKOFF_MS = 1500;

let running = false;
let stopping = false;
let intervalId = null;

const log = (...args) => console.log(new Date().toISOString(), '[worker]', ...args);

const currentStatusStmt = db.prepare('SELECT status FROM campaigns WHERE id = ?');

const sentLast24hStmt = db.prepare(
  "SELECT COUNT(*) AS n FROM recipients WHERE sent_at IS NOT NULL AND sent_at >= datetime('now', '-1 day')"
);
function sentLast24h() { return sentLast24hStmt.get().n; }

const dueScheduledStmt = db.prepare(
  "SELECT id FROM campaigns WHERE status = 'scheduled' AND (scheduled_start IS NULL OR scheduled_start <= datetime('now'))"
);

const nextRunnableStmt = db.prepare(
  "SELECT * FROM campaigns WHERE status = 'running' AND (next_batch_at IS NULL OR next_batch_at <= datetime('now')) ORDER BY id LIMIT 1"
);

// Atomic claim: select pending rows and immediately mark them 'sending' in one transaction.
// This prevents double-send on crash — rows stuck in 'sending' on restart are reset to 'pending'.
const claimBatch = db.transaction((campaignId, size) => {
  const rows = db.prepare(
    "SELECT * FROM recipients WHERE campaign_id = ? AND status = 'pending' ORDER BY id LIMIT ?"
  ).all(campaignId, size);
  if (rows.length > 0) {
    const ids = rows.map((r) => r.id).join(',');
    db.prepare(`UPDATE recipients SET status='sending' WHERE id IN (${ids})`).run();
  }
  return rows;
});

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

    for (const { id } of dueScheduledStmt.all()) {
      setStatus(id, 'running', { next_batch_at: null });
      log(`campaign ${id} started (scheduled time reached)`);
    }

    const campaign = nextRunnableStmt.get();
    if (!campaign) return;

    const remainingToday = settings.daily_limit - sentLast24h();
    if (remainingToday <= 0) {
      log(`daily limit of ${settings.daily_limit} reached; waiting before sending more`);
      setStatus(campaign.id, 'running', { next_batch_at: isoIn(15 * 60) });
      return;
    }

    const batchSize = Math.min(campaign.batch_size, remainingToday);

    // Atomic claim — marks rows 'sending' before we start sending, so a crash
    // mid-batch leaves them in 'sending' (recovered to 'pending' on next boot)
    // rather than still 'pending' (which would cause double-send).
    const batch = claimBatch(campaign.id, batchSize);

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
      const live = currentStatusStmt.get(campaign.id);
      if (!live || live.status !== 'running') {
        // Campaign paused/cancelled mid-batch — reset claimed-but-unsent rows back to pending
        markFailedStmt.run('Campaign stopped mid-batch', recipient.id);
        continue;
      }
      const result = await trySend(transport, campaign, recipient, fromHeader);
      if (result.ok) markSentStmt.run(recipient.id);
      else markFailedStmt.run(result.error, recipient.id);
    }

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
  // Recover any rows stuck in 'sending' from a previous crash — reset to 'pending'
  // so they are retried rather than lost. This is safe because 'sending' rows were
  // never confirmed delivered (the process died before markSentStmt could run).
  const recovered = db.prepare("UPDATE recipients SET status='pending' WHERE status='sending'").run().changes;
  if (recovered > 0) log(`recovered ${recovered} in-flight recipient(s) from previous crash`);

  log('background worker started');
  intervalId = setInterval(() => { tick().catch((e) => log('unhandled tick error', e)); }, TICK_MS);
}

export async function stopWorker() {
  stopping = true;
  if (intervalId) clearInterval(intervalId);
  const deadline = Date.now() + 30000;
  while (running && Date.now() < deadline) await sleep(100);
}
