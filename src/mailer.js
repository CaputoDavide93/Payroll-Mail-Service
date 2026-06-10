import nodemailer from 'nodemailer';
import { getSettings } from './settings.js';

// Build a fresh transporter from the current settings. Cheap enough to do per batch,
// and means settings changes take effect without a restart.
export function buildTransport() {
  const s = getSettings();
  if (!s.smtp_host || !s.smtp_user || !s.smtp_pass) {
    throw new Error('SMTP is not configured yet. Open Settings and add the Gmail/Workspace details.');
  }
  return nodemailer.createTransport({
    host: s.smtp_host,
    port: s.smtp_port,
    secure: !!s.smtp_secure, // true for 465, false for 587 (STARTTLS)
    auth: { user: s.smtp_user, pass: s.smtp_pass },
    pool: true,
    maxConnections: 1,
    maxMessages: 100
  });
}

// Escape text so user-typed bodies can't break the HTML we wrap them in.
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// Replace {placeholders} with recipient fields. Unknown placeholders are left blank.
export function renderTemplate(template, fields) {
  return String(template).replace(/\{\s*([\w.-]+)\s*\}/g, (_, key) => {
    const v = fields[key.toLowerCase()] ?? fields[key];
    return v === undefined || v === null ? '' : String(v);
  });
}

function fieldsFor(recipient) {
  let extra = {};
  try { extra = JSON.parse(recipient.fields_json || '{}'); } catch { /* ignore */ }
  // Normalize keys to lowercase so {Name}, {name}, {NAME} all work.
  const lower = {};
  for (const [k, v] of Object.entries(extra)) lower[k.toLowerCase()] = v;
  return { ...lower, name: recipient.name, email: recipient.email };
}

// Send one message. `campaign` provides subject/body/attachment/from.
export async function sendOne(transport, campaign, recipient, fromHeader) {
  const fields = fieldsFor(recipient);
  const subject = renderTemplate(campaign.subject, fields);
  const bodyText = renderTemplate(campaign.body, fields);
  const html = `<!doctype html><html><body style="font-family:Arial,Helvetica,sans-serif;font-size:15px;color:#222;line-height:1.5">${
    escapeHtml(bodyText).replace(/\n/g, '<br>')
  }</body></html>`;

  const message = {
    from: fromHeader,
    to: recipient.email,
    subject,
    text: bodyText,
    html
  };

  if (campaign.attachment_path) {
    message.attachments = [{
      filename: campaign.attachment_name || 'attachment',
      path: campaign.attachment_path
    }];
  }

  return transport.sendMail(message);
}

export function fromHeaderFor(campaign) {
  const s = getSettings();
  const name = campaign.from_name || s.from_name || '';
  const email = campaign.from_email || s.from_email || s.smtp_user;
  return name ? `"${name.replace(/"/g, '')}" <${email}>` : email;
}

// Verify the SMTP connection and optionally send a test email.
export async function sendTest(toEmail, sampleName = 'there') {
  const transport = buildTransport();
  await transport.verify();
  const s = getSettings();
  const from = s.from_name ? `"${s.from_name}" <${s.from_email || s.smtp_user}>` : (s.from_email || s.smtp_user);
  await transport.sendMail({
    from,
    to: toEmail,
    subject: 'Payroll Mail Service — test email',
    text: `Hi ${sampleName},\n\nThis is a test email confirming your Payroll Mail Service is connected to Gmail/Workspace correctly.\n\nYou're ready to send.`,
    html: `<p>Hi ${escapeHtml(sampleName)},</p><p>This is a test email confirming your <b>Payroll Mail Service</b> is connected to Gmail/Workspace correctly.</p><p>You're ready to send. 🎉</p>`
  });
  transport.close();
}
