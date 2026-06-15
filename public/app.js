'use strict';

const $ = (sel) => document.querySelector(sel);

// ---- API helper with optional password header ----
let appPassword = sessionStorage.getItem('appPassword') || '';

async function api(path, opts = {}) {
  const headers = opts.headers || {};
  if (appPassword) headers['x-app-password'] = appPassword;
  const res = await fetch(path, { ...opts, headers });
  let data = null;
  try { data = await res.json(); } catch { /* no body */ }
  if (res.status === 401) { promptLogin(); throw new Error('Unauthorized'); }
  if (!res.ok) throw new Error((data && data.error) || `Request failed (${res.status})`);
  return data;
}

// ---- Login ----
function promptLogin() {
  const dlg = $('#loginDialog');
  if (!dlg.open) dlg.showModal();
}

$('#loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  appPassword = $('#loginPassword').value;
  sessionStorage.setItem('appPassword', appPassword);
  try {
    await api('/api/settings');
    $('#loginDialog').close();
    boot();
  } catch {
    $('#loginError').textContent = 'Wrong password, try again.';
  }
});

// ---- How to dialog ----
$('#howtoBtn').addEventListener('click', () => $('#howtoDialog').showModal());
$('#howtoClose').addEventListener('click', () => $('#howtoDialog').close());

// ---- Settings dialog ----
const settingsDialog = $('#settingsDialog');
$('#settingsBtn').addEventListener('click', () => openSettings());
$('#settingsClose').addEventListener('click', () => settingsDialog.close());

async function openSettings() {
  const s = await api('/api/settings');
  const f = $('#settingsForm');
  f.smtp_host.value = s.smtp_host;
  f.smtp_port.value = String(s.smtp_port);
  f.smtp_user.value = s.smtp_user;
  f.from_name.value = s.from_name;
  f.from_email.value = s.from_email;
  f.daily_limit.value = s.daily_limit;
  f.smtp_pass.value = '';
  $('#passHint').textContent = s.smtp_pass_set ? 'A password is already saved — leave blank to keep it.' : '';
  $('#settingsStatus').textContent = '';
  settingsDialog.showModal();
}

async function saveSettings() {
  const f = $('#settingsForm');
  const body = {
    smtp_host: f.smtp_host.value,
    smtp_port: f.smtp_port.value,
    smtp_secure: f.smtp_port.value === '465',
    smtp_user: f.smtp_user.value,
    smtp_pass: f.smtp_pass.value,
    from_name: f.from_name.value,
    from_email: f.from_email.value,
    daily_limit: f.daily_limit.value
  };
  return api('/api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}

$('#settingsForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const st = $('#settingsStatus');
  try {
    await saveSettings();
    st.className = 'status ok'; st.textContent = 'Saved.';
  } catch (err) {
    st.className = 'status err'; st.textContent = err.message;
  }
});

$('#testBtn').addEventListener('click', async () => {
  const to = $('#testTo').value.trim();
  const st = $('#settingsStatus');
  if (!to) { st.className = 'status err'; st.textContent = 'Enter an address to send the test to.'; return; }
  st.className = 'status'; st.textContent = 'Saving & sending test…';
  try {
    await saveSettings(); // make sure the test uses exactly what's on screen
    await api('/api/settings/test', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ to }) });
    st.className = 'status ok'; st.textContent = `Test sent to ${to} — check the inbox.`;
  } catch (err) {
    st.className = 'status err'; st.textContent = 'Test failed: ' + err.message;
  }
});

// ---- Attachment type toggle ----
async function loadPayslipRuns() {
  const sel = $('#payslipRunSelect');
  try {
    const headers = {};
    if (appPassword) headers['x-app-password'] = appPassword;
    const runs = await fetch('/api/payslips/runs', { headers }).then((r) => r.json());
    sel.innerHTML = '<option value="">— select a prepared run —</option>';
    if (!runs.length) {
      sel.innerHTML += '<option disabled>No prepared runs found — use the Payslips page first</option>';
    } else {
      runs.forEach((r) => {
        const opt = document.createElement('option');
        opt.value = r.run_id;
        opt.textContent = `${r.run_id} — ${r.total} payslips`;
        sel.appendChild(opt);
      });
    }
  } catch { /* ignore */ }
}

document.querySelectorAll('input[name="attachType"]').forEach((radio) => {
  radio.addEventListener('change', () => {
    const isPayslips = $('#attachTypePayslips').checked;
    $('#normalAttachRow').style.display = isPayslips ? 'none' : '';
    $('#payslipsAttachRow').style.display = isPayslips ? '' : 'none';
    $('#recipientsFile').required = !isPayslips;
    if (isPayslips) loadPayslipRuns();
  });
});

// ---- New campaign ----
$('#recipientsFile').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    const lines = reader.result.split(/\r?\n/).filter((l) => l.trim().length).length;
    const rows = Math.max(0, lines - 1);
    $('#recipientsHint').textContent = `${file.name}: about ${rows} recipient${rows === 1 ? '' : 's'} detected.`;
  };
  reader.readAsText(file.slice(0, 200000)); // header + a sample is enough for a rough count
});

$('#attachmentFile').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (file) $('#attachmentHint').textContent = `${file.name} (${(file.size / 1024 / 1024).toFixed(2)} MB)`;
});

$('#campaignForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  const st = $('#campaignStatus');
  const btn = $('#createBtn');

  const isPayslips = $('#attachTypePayslips').checked;
  const run_id = $('#payslipRunSelect').value;

  if (isPayslips && !run_id) {
    st.className = 'status err'; st.textContent = 'Please select a prepared payslips run.';
    return;
  }

  const fd = new FormData(form);
  // Convert the local schedule time to an absolute UTC instant for the server.
  const sched = $('#scheduledStart').value;
  fd.set('scheduled_start', sched ? new Date(sched).toISOString() : '');
  fd.set('as_draft', $('#asDraft').checked ? 'true' : 'false');
  if (isPayslips) fd.set('run_id', run_id);

  btn.disabled = true;
  st.className = 'status'; st.textContent = 'Uploading…';
  try {
    const headers = {};
    if (appPassword) headers['x-app-password'] = appPassword;
    const res = await fetch('/api/campaigns', { method: 'POST', headers, body: fd });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to create campaign.');
    st.className = 'status ok';
    let msg = `Created — ${data.accepted} recipient${data.accepted === 1 ? '' : 's'} queued.`;
    if (data.skipped && data.skipped.length) msg += ` ${data.skipped.length} row(s) skipped.`;
    st.textContent = msg;
    form.reset();
    $('#attachTypeFile').checked = true;
    $('#normalAttachRow').style.display = '';
    $('#payslipsAttachRow').style.display = 'none';
    $('#recipientsFile').required = true;
    $('#recipientsHint').innerHTML = 'Needs an <code>email</code> column; a <code>name</code> column is recommended.';
    $('#attachmentHint').textContent = 'Max 25 MB. The same file goes to everyone.';
    loadCampaigns();
  } catch (err) {
    st.className = 'status err'; st.textContent = err.message;
  } finally {
    btn.disabled = false;
  }
});

// ---- Campaign list ----
const fmt = (t) => t ? new Date(t.replace(' ', 'T') + 'Z').toLocaleString() : '';

function controlsFor(c) {
  const buttons = [];
  if (c.status === 'draft') buttons.push(`<button class="btn small primary" data-act="start" data-id="${c.id}">Start</button>`);
  if (c.status === 'scheduled') buttons.push(`<button class="btn small" data-act="pause" data-id="${c.id}">Cancel schedule</button>`);
  if (c.status === 'running') buttons.push(`<button class="btn small" data-act="pause" data-id="${c.id}">Pause</button>`);
  if (c.status === 'paused') buttons.push(`<button class="btn small primary" data-act="resume" data-id="${c.id}">Resume</button>`);
  if (['running', 'scheduled', 'paused'].includes(c.status))
    buttons.push(`<button class="btn small danger" data-act="cancel" data-id="${c.id}">Stop</button>`);
  if (c.stats.failed > 0 && c.status !== 'running')
    buttons.push(`<button class="btn small" data-act="requeue-failed" data-id="${c.id}">Retry failed</button>`);
  buttons.push(`<button class="btn small" data-act="preview" data-id="${c.id}">Send preview</button>`);
  buttons.push(`<button class="btn small danger" data-act="delete" data-id="${c.id}">Delete</button>`);
  return buttons.join('');
}

function renderCampaign(c) {
  const s = c.stats;
  const sentPct = s.total ? (s.sent / s.total) * 100 : 0;
  const failPct = s.total ? (s.failed / s.total) * 100 : 0;
  const sched = c.scheduled_start && c.status === 'scheduled' ? ` · starts ${fmt(c.scheduled_start)}` : '';
  const attach = c.attachment_name ? ` · 📎 ${esc(c.attachment_name)}` : '';
  const failures = (c.failures && c.failures.length)
    ? `<div class="failures"><details><summary>${c.failures.length} failed — view</summary><ul>${
        c.failures.slice(0, 50).map((f) => `<li>${esc(f.email)}: ${esc(f.error || 'error')}</li>`).join('')
      }</ul></details></div>`
    : '';
  return `
    <div class="campaign" data-id="${c.id}">
      <div class="head">
        <div>
          <div class="title">${esc(c.name)}</div>
          <div class="sub">${esc(c.subject)}${attach}${sched}</div>
        </div>
        <span class="badge ${esc(c.status)}">${esc(c.status)}</span>
      </div>
      <div class="bar">
        <div class="seg-sent" style="width:${sentPct}%"></div>
        <div class="seg-failed" style="width:${failPct}%"></div>
      </div>
      <div class="counts">
        <span><b>${s.sent}</b> sent</span>
        <span><b>${s.pending}</b> pending</span>
        <span><b>${s.failed}</b> failed</span>
        <span>of <b>${s.total}</b></span>
      </div>
      <div class="controls">${controlsFor(c)}</div>
      ${failures}
    </div>`;
}

function esc(s) {
  return String(s).replace(/[&<>]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[ch]));
}

let lastSig = '';
async function loadCampaigns() {
  try {
    // The list endpoint already includes failure details, so this is a single request.
    const list = await api('/api/campaigns');
    const el = $('#campaignList');
    if (!list.length) { el.innerHTML = '<p class="muted">No sends yet. Create one above.</p>'; lastSig = 'empty'; return; }
    // Only re-render when something actually changed, so an open "failed — view"
    // panel isn't collapsed on every poll.
    const sig = JSON.stringify(list);
    if (sig === lastSig) return;
    lastSig = sig;
    el.innerHTML = list.map(renderCampaign).join('');
  } catch (err) {
    lastSig = ''; // force re-render on recovery after server outage
    if (err.message !== 'Unauthorized') {
      const p = document.createElement('p');
      p.className = 'error';
      p.textContent = err.message;
      $('#campaignList').replaceChildren(p);
    }
  }
}

$('#campaignList').addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-act]');
  if (!btn) return;
  const { act, id } = btn.dataset;
  if (act === 'delete' && !confirm('Delete this send? This cannot be undone.')) return;
  if (act === 'cancel' && !confirm('Stop this send? Remaining recipients will not receive the email.')) return;
  btn.disabled = true;
  try {
    if (act === 'preview') {
      const to = prompt('Send a preview of this email (with the attachment) to which address?');
      if (to && to.trim()) {
        await api(`/api/campaigns/${id}/test`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ to: to.trim() }) });
        alert('Preview sent to ' + to.trim() + ' — check the inbox.');
      }
    } else if (act === 'delete') {
      await api('/api/campaigns/' + id, { method: 'DELETE' });
    } else {
      await api(`/api/campaigns/${id}/${act}`, { method: 'POST' });
    }
    lastSig = ''; // force a refresh after any state change
    loadCampaigns();
  } catch (err) {
    alert(err.message);
  } finally {
    btn.disabled = false;
  }
});

$('#refreshBtn').addEventListener('click', loadCampaigns);

// ---- Boot ----
async function boot() {
  loadCampaigns();
  const s = await api('/api/settings').catch(() => null);
  if (s && !s.configured) openSettings(); // nudge first-time setup
}

async function init() {
  const cfg = await fetch('/api/config').then((r) => r.json()).catch(() => ({ authRequired: false }));
  if (cfg.authRequired && !appPassword) { promptLogin(); return; }
  if (cfg.authRequired) {
    try { await api('/api/settings'); } catch { promptLogin(); return; }
  }
  boot();
}

setInterval(() => { if (!document.hidden) loadCampaigns(); }, 4000);
init();
