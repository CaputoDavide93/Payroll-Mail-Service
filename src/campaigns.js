import db from './db.js';

const insertCampaign = db.prepare(`
  INSERT INTO campaigns
    (name, subject, body, from_name, from_email, attachment_path, attachment_name,
     batch_size, batch_interval_seconds, scheduled_start, status)
  VALUES
    (@name, @subject, @body, @from_name, @from_email, @attachment_path, @attachment_name,
     @batch_size, @batch_interval_seconds, @scheduled_start, @status)
`);

const insertRecipient = db.prepare(`
  INSERT INTO recipients (campaign_id, email, name, fields_json, attachment_path)
  VALUES (@campaign_id, @email, @name, @fields_json, @attachment_path)
`);

// Create a campaign and its recipients atomically.
export const createCampaign = db.transaction((campaign, recipients) => {
  const info = insertCampaign.run(campaign);
  const campaignId = info.lastInsertRowid;
  for (const r of recipients) {
    insertRecipient.run({
      campaign_id: campaignId,
      email: r.email,
      name: r.name || '',
      fields_json: r.fields_json ?? JSON.stringify(r.fields || {}),
      attachment_path: r.attachment_path || null
    });
  }
  return campaignId;
});

const statsStmt = db.prepare(`
  SELECT status, COUNT(*) AS n FROM recipients WHERE campaign_id = ? GROUP BY status
`);

export function campaignStats(campaignId) {
  const out = { total: 0, pending: 0, sent: 0, failed: 0 };
  for (const row of statsStmt.all(campaignId)) {
    out[row.status] = row.n;
    out.total += row.n;
  }
  return out;
}

const getCampaignStmt = db.prepare('SELECT * FROM campaigns WHERE id = ?');
const listCampaignsStmt = db.prepare('SELECT * FROM campaigns ORDER BY id DESC');
const allStatsStmt = db.prepare('SELECT campaign_id, status, COUNT(*) AS n FROM recipients GROUP BY campaign_id, status');
const allFailuresStmt = db.prepare("SELECT campaign_id, email, name, error FROM recipients WHERE status='failed' ORDER BY campaign_id, id");

export function getCampaign(id) {
  return getCampaignStmt.get(id);
}

const firstRecipientStmt = db.prepare('SELECT * FROM recipients WHERE campaign_id = ? ORDER BY id LIMIT 1');
export function firstRecipient(id) {
  return firstRecipientStmt.get(id);
}

export function listCampaigns() {
  const campaigns = listCampaignsStmt.all();
  if (campaigns.length === 0) return [];

  // Build stats and failures in 2 bulk queries instead of 2n per-campaign queries.
  const statsMap = {};
  for (const row of allStatsStmt.all()) {
    if (!statsMap[row.campaign_id]) statsMap[row.campaign_id] = { total: 0, pending: 0, sent: 0, failed: 0 };
    statsMap[row.campaign_id][row.status] = row.n;
    statsMap[row.campaign_id].total += row.n;
  }

  const failuresMap = {};
  for (const row of allFailuresStmt.all()) {
    if (!failuresMap[row.campaign_id]) failuresMap[row.campaign_id] = [];
    if (failuresMap[row.campaign_id].length < 100) {
      failuresMap[row.campaign_id].push({ email: row.email, name: row.name, error: row.error });
    }
  }

  return campaigns.map((c) => ({
    ...c,
    stats: statsMap[c.id] || { total: 0, pending: 0, sent: 0, failed: 0 },
    failures: failuresMap[c.id] || []
  }));
}

export function setStatus(id, status, extra = {}) {
  const fields = ['status = @status', "updated_at = datetime('now')"];
  const params = { id, status, ...extra };
  if ('next_batch_at' in extra) fields.push('next_batch_at = @next_batch_at');
  if ('scheduled_start' in extra) fields.push('scheduled_start = @scheduled_start');
  db.prepare(`UPDATE campaigns SET ${fields.join(', ')} WHERE id = @id`).run(params);
}

const failedRecipientsStmt = db.prepare(
  "SELECT email, name, error FROM recipients WHERE campaign_id = ? AND status = 'failed' ORDER BY id LIMIT 100"
);
export function failedRecipients(id) {
  return failedRecipientsStmt.all(id);
}

const deleteCampaignStmt = db.prepare('DELETE FROM campaigns WHERE id = ?');
export function deleteCampaign(id) {
  deleteCampaignStmt.run(id);
}

// Reset failed recipients back to pending so a campaign can retry them.
const requeueFailedStmt = db.prepare(
  "UPDATE recipients SET status='pending', error=NULL, attempts=0 WHERE campaign_id = ? AND status='failed'"
);
export function requeueFailed(id) {
  return requeueFailedStmt.run(id).changes;
}
