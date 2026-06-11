import nodemailer from 'nodemailer';
import path from 'node:path';
import fs from 'node:fs';
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
    maxMessages: Infinity
  });
}

// Escape text so user-typed bodies can't break the HTML we wrap them in.
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// Collapse CR/LF so values placed into email headers can't inject extra headers.
// (nodemailer also guards this, but we don't want to rely solely on the library.)
function stripHeader(value) {
  return String(value).replace(/[\r\n]+/g, ' ').trim();
}

// Build a "Name <email>" From header from raw operator-supplied parts.
function buildFrom(name, email) {
  const e = stripHeader(email);
  const n = stripHeader(name).replace(/"/g, '');
  return n ? `"${n}" <${e}>` : e;
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
// `toOverride` redirects delivery (used for previews) while still rendering
// the template against the sample recipient's fields.
export async function sendOne(transport, campaign, recipient, fromHeader, toOverride) {
  const fields = fieldsFor(recipient);
  const subject = stripHeader(renderTemplate(campaign.subject, fields));
  const bodyText = renderTemplate(campaign.body, fields);
  const html = `<!doctype html><html><body style="font-family:Arial,Helvetica,sans-serif;font-size:15px;color:#222;line-height:1.5">${
    escapeHtml(bodyText).replace(/\n/g, '<br>')
  }</body></html>`;

  const message = {
    from: fromHeader,
    to: toOverride || recipient.email,
    subject,
    text: bodyText,
    html
  };

  // Per-recipient attachment takes precedence over campaign-level attachment.
  const attachPath = recipient.attachment_path || campaign.attachment_path;
  if (attachPath) {
    if (!fs.existsSync(attachPath)) {
      throw new Error(`Attachment file not found: ${path.basename(attachPath)}`);
    }
    const attachName = recipient.attachment_path
      ? path.basename(recipient.attachment_path)
      : (campaign.attachment_name || 'attachment');
    message.attachments = [{ filename: attachName, path: attachPath }];
  }

  return transport.sendMail(message);
}

export function fromHeaderFor(campaign) {
  const s = getSettings();
  return buildFrom(campaign.from_name || s.from_name || '', campaign.from_email || s.from_email || s.smtp_user);
}

// Verify the SMTP connection and optionally send a test email.
export async function sendTest(toEmail, sampleName = 'there') {
  const transport = buildTransport();
  try {
    await transport.verify();
    const s = getSettings();
    const from = buildFrom(s.from_name, s.from_email || s.smtp_user);
    await transport.sendMail({
      from,
      to: toEmail,
      subject: 'Payroll Mail Service — test email',
      text: `Hi ${sampleName},\n\nThis is a test email confirming your Payroll Mail Service is connected to Gmail/Workspace correctly.\n\nYou're ready to send.`,
      html: `<p>Hi ${escapeHtml(sampleName)},</p><p>This is a test email confirming your <b>Payroll Mail Service</b> is connected to Gmail/Workspace correctly.</p><p>You're ready to send. 🎉</p>`
    });
  } finally {
    try { transport.close(); } catch { /* ignore */ }
  }
}
