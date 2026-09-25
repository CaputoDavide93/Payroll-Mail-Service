import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';

// Point DATA_DIR at a throwaway folder before the modules open the DB.
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'retention-'));

let pp;
let campaigns;
before(async () => {
  pp = await import('../src/prepare-payslips.js');
  campaigns = await import('../src/campaigns.js');
});

function makeRun(id, ageDays) {
  const dir = path.join(pp.PAYSLIPS_DIR, id, 'protected');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'a_protected.pdf');
  fs.writeFileSync(file, 'x');
  const results = path.join(pp.PAYSLIPS_DIR, id, 'results.json');
  fs.writeFileSync(results, '{}');
  const t = new Date(Date.now() - ageDays * 86400000);
  fs.utimesSync(results, t, t);
  return { runDir: path.join(pp.PAYSLIPS_DIR, id), file };
}

describe('payslip retention', () => {
  it('defaults to delete-after-send and 7 days', () => {
    assert.equal(pp.DELETE_AFTER_SEND, true);
    assert.equal(pp.RETENTION_DAYS, 7);
  });

  it('purges only runs older than the window', () => {
    const old = makeRun('oldrun1', 10);
    const fresh = makeRun('freshrun1', 1);
    assert.equal(pp.purgeExpiredRuns(7), 1);
    assert.ok(!fs.existsSync(old.runDir));
    assert.ok(fs.existsSync(fresh.runDir));
  });

  it('keeps expired runs that still have unsent recipients', () => {
    const run = makeRun('pausedrun1', 30);
    campaigns.createCampaign({
      name: 'c', subject: 's', body: 'b', from_name: '', from_email: '',
      attachment_path: null, attachment_name: null, batch_size: 10,
      batch_interval_seconds: 60, scheduled_start: null, status: 'paused'
    }, [{ email: 'a@example.com', name: 'A', attachment_path: run.file }]);
    assert.equal(campaigns.hasPendingAttachment(run.file), true);
    assert.equal(pp.purgeExpiredRuns(7, campaigns.hasPendingAttachmentUnder), 0);
    assert.ok(fs.existsSync(run.runDir));
  });

  it('0 days disables purging', () => {
    makeRun('neverrun1', 365);
    assert.equal(pp.purgeExpiredRuns(0), 0);
  });

  it('deletePayslipFile refuses paths outside the payslips folder', () => {
    const outside = path.join(process.env.DATA_DIR, 'uploads', 'shared.pdf');
    fs.writeFileSync(outside, 'x');
    assert.equal(pp.deletePayslipFile(outside), false);
    assert.ok(fs.existsSync(outside));
    const run = makeRun('sentrun1', 0);
    assert.equal(pp.deletePayslipFile(run.file), true);
    assert.ok(!fs.existsSync(run.file));
  });
});
