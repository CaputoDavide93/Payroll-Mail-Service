import { describe, it, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'settings-'));
delete process.env.SMTP_HOST_ALLOWLIST;

let settings;
before(async () => {
  settings = await import('../src/settings.js');
});

describe('SMTP host allowlist', () => {
  beforeEach(() => { delete process.env.SMTP_HOST_ALLOWLIST; });

  it('accepts Google SMTP hosts by default', () => {
    const s = settings.updateSettings({ smtp_host: 'smtp.gmail.com', smtp_user: 'a@example.com', smtp_pass: 'secret' });
    assert.equal(s.smtp_host, 'smtp.gmail.com');
    assert.equal(s.smtp_pass_set, true);
  });

  it('rejects a host outside the allowlist', () => {
    assert.throws(() => settings.updateSettings({ smtp_host: 'evil.example.com', smtp_pass: 'x' }), /not allowed/);
    assert.equal(settings.getSettings().smtp_host, 'smtp.gmail.com');
  });

  it('requires the password again when the host changes', () => {
    assert.throws(() => settings.updateSettings({ smtp_host: 'smtp-relay.gmail.com', smtp_pass: '' }), /Re-enter the app password/);
    const s = settings.updateSettings({ smtp_host: 'smtp-relay.gmail.com', smtp_pass: 'new-secret' });
    assert.equal(s.smtp_host, 'smtp-relay.gmail.com');
  });

  it('keeps the saved password when the host is unchanged', () => {
    const s = settings.updateSettings({ smtp_host: 'smtp-relay.gmail.com', smtp_pass: '', from_name: 'Payroll' });
    assert.equal(s.smtp_pass_set, true);
    assert.equal(settings.getSettings().smtp_pass, 'new-secret');
  });

  it('honours SMTP_HOST_ALLOWLIST and the * escape hatch', () => {
    process.env.SMTP_HOST_ALLOWLIST = 'smtp.office365.com';
    assert.throws(() => settings.assertSmtpHostAllowed('smtp.gmail.com'), /not allowed/);
    settings.assertSmtpHostAllowed('SMTP.office365.com');
    process.env.SMTP_HOST_ALLOWLIST = '*';
    settings.assertSmtpHostAllowed('anything.example.com');
  });
});
