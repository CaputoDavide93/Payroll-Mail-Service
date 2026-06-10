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
  INSERT INTO recipients (campaign_id, email, name, fields_json)
  VALUES (@campaign_id, @email, @name, @fields_json)
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
      fields_json: JSON.stringify(r.fields || {})
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

export function getCampaign(id) {
  return getCampaignStmt.get(id);
}

export function listCampaigns() {
  return listCampaignsStmt.all().map((c) => ({ ...c, stats: campaignStats(c.id) }));
}

export function setStatus(id, status, extra = {}) {
  const fields = ['status = @status', "updated_at = datetime('now')"];
  const params = { id, status, ...extra };
  if ('next_batch_at' in extra) fields.push('next_batch_at = @next_batch_at');
  if ('scheduled_start' in extra) fields.push('scheduled_start = @scheduled_start');
  db.prepare(`UPDATE campaigns SET ${fields.join(', ')} WHERE id = @id`).run(params);
}

const failedRecipientsStmt = db.prepare(
  "SELECT email, name, error FROM recipients WHERE campaign_id = ? AND status = 'failed' ORDER BY id"
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
