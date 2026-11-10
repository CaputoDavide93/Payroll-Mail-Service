import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';

// Boots the real server.js (Express, multer, better-sqlite3) and exercises the HTTP surface,
// so a framework or native-module bump that breaks routing, uploads or the DB fails here.
const PASSWORD = 'smoke-test-password';
let child;
let base;
let dataDir;

const freePort = () => new Promise((resolve, reject) => {
  const srv = net.createServer();
  srv.listen(0, '127.0.0.1', () => { const { port } = srv.address(); srv.close(() => resolve(port)); });
  srv.on('error', reject);
});
const api = (p, opts = {}) => fetch(base + p, { ...opts, headers: { 'x-app-password': PASSWORD, ...opts.headers } });

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'smoke-'));
  const port = await freePort();
  base = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, ['server.js'], {
    env: { ...process.env, PORT: String(port), DATA_DIR: dataDir, APP_PASSWORD: PASSWORD },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  const deadline = Date.now() + 15000;
  for (;;) {
    try { if ((await fetch(base + '/api/config')).ok) break; } catch { /* not up yet */ }
    if (Date.now() > deadline) throw new Error('server did not start');
    await new Promise((r) => setTimeout(r, 100));
  }
});

after(() => { child?.kill('SIGTERM'); fs.rmSync(dataDir, { recursive: true, force: true }); });

describe('HTTP smoke', () => {
  it('serves config without a password and the static page', async () => {
    assert.deepEqual(await (await fetch(base + '/api/config')).json(), { authRequired: true });
    const page = await fetch(base + '/');
    assert.equal(page.status, 200);
    assert.match(await page.text(), /<html/i);
  });

  it('rejects API calls without the password and accepts them with it', async () => {
    assert.equal((await fetch(base + '/api/campaigns')).status, 401);
    const ok = await api('/api/campaigns');
    assert.equal(ok.status, 200);
    assert.deepEqual(await ok.json(), []);
  });

  it('handles a body-less POST as a clean 4xx, not a crash', async () => {
    const r = await api('/api/settings/test', { method: 'POST' });
    assert.ok(r.status >= 400 && r.status < 500);
    assert.equal((await r.json()).error.includes('undefined'), false);
  });

  it('creates, reads and deletes a campaign via multipart upload', async () => {
    const form = new FormData();
    form.set('name', 'Smoke');
    form.set('subject', 'Hello');
    form.set('body', 'Hi {{name}}');
    form.set('as_draft', 'true');
    form.set('recipients', new Blob(['email,name\na@example.com,Ann\nb@example.com,Bob\n'], { type: 'text/csv' }), 'r.csv');
    form.set('attachment', new Blob(['%PDF-1.4 test'], { type: 'application/pdf' }), 'a.pdf');
    const created = await api('/api/campaigns', { method: 'POST', body: form });
    assert.equal(created.status, 200);
    const { id, accepted } = await created.json();
    assert.equal(accepted, 2);

    const got = await api(`/api/campaigns/${id}`);
    assert.equal(got.status, 200);
    assert.equal((await got.json()).name, 'Smoke');

    const del = await api(`/api/campaigns/${id}`, { method: 'DELETE' });
    assert.equal(del.status, 200);
    assert.equal((await api(`/api/campaigns/${id}`)).status, 404);
  });

  it('reads and updates settings as JSON', async () => {
    const r = await api('/api/settings', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ smtp_host: 'smtp.gmail.com' })
    });
    assert.equal(r.status, 200);
    assert.equal((await r.json()).smtp_host, 'smtp.gmail.com');
  });

  it('serves the sample payslip workbook and the run list', async () => {
    const x = await fetch(base + '/api/payslips/sample-excel');
    assert.equal(x.status, 200);
    assert.ok((await x.arrayBuffer()).byteLength > 100);
    assert.equal((await api('/api/payslips/runs')).status, 200);
  });
});
