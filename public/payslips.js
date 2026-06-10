'use strict';

const $ = (sel) => document.querySelector(sel);

// sessionStorage scopes the password to this tab session only (safer than localStorage for PII workflows)
let appPassword = sessionStorage.getItem('appPassword') || '';
let currentRunId = null;

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
  } catch {
    $('#loginError').textContent = 'Wrong password, try again.';
  }
});

// ---- Settings ----
$('#settingsBtn').addEventListener('click', openSettings);
$('#settingsClose').addEventListener('click', () => $('#settingsDialog').close());

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
  $('#settingsDialog').showModal();
}

$('#settingsForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = $('#settingsForm');
  const st = $('#settingsStatus');
  try {
    await api('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        smtp_host: f.smtp_host.value, smtp_port: f.smtp_port.value,
        smtp_secure: f.smtp_port.value === '465',
        smtp_user: f.smtp_user.value, smtp_pass: f.smtp_pass.value,
        from_name: f.from_name.value, from_email: f.from_email.value,
        daily_limit: f.daily_limit.value
      })
    });
    st.className = 'status ok'; st.textContent = 'Saved.';
  } catch (err) {
    st.className = 'status err'; st.textContent = err.message;
  }
});

$('#testBtn').addEventListener('click', async () => {
  const to = $('#testTo').value.trim();
  const st = $('#settingsStatus');
  if (!to) { st.className = 'status err'; st.textContent = 'Enter a test address.'; return; }
  st.className = 'status'; st.textContent = 'Sending…';
  try {
    await api('/api/settings/test', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ to }) });
    st.className = 'status ok'; st.textContent = `Sent to ${to}.`;
  } catch (err) {
    st.className = 'status err'; st.textContent = 'Test failed: ' + err.message;
  }
});

// ---- Step navigation ----
function showStep(n) {
  $('#step1').style.display = n === 1 ? '' : 'none';
  $('#step2').style.display = n === 2 ? '' : 'none';
  $('#step3').style.display = n === 3 ? '' : 'none';
}

$('#backBtn').addEventListener('click', () => showStep(1));
$('#backBtn2').addEventListener('click', () => showStep(2));
$('#sendSetupBtn').addEventListener('click', () => showStep(3));

// ---- DOM helpers ----
function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

// ---- Step 1: Prepare ----
$('#prepareBtn').addEventListener('click', async () => {
  const excelFile = $('#excelFile').files[0];
  const zipFile = $('#zipFile').files[0];
  const st = $('#prepareStatus');

  if (!excelFile) { st.className = 'status err'; st.textContent = 'Please select the Excel file.'; return; }
  if (!zipFile) { st.className = 'status err'; st.textContent = 'Please select the ZIP file.'; return; }

  st.className = 'status'; st.textContent = 'Uploading and processing… this may take a moment.';
  $('#prepareBtn').disabled = true;

  try {
    const fd = new FormData();
    fd.append('excel', excelFile);
    fd.append('zip', zipFile);
    const headers = {};
    if (appPassword) headers['x-app-password'] = appPassword;
    const res = await fetch('/api/payslips/prepare', { method: 'POST', headers, body: fd });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Prepare failed.');

    currentRunId = data.run_id;
    // Reset pre-flight on new prepare
    $('#preflightResult').textContent = '';
    $('#preflightStatus').textContent = '';
    renderMatchResults(data);
    st.textContent = '';
    showStep(2);
    loadRuns();
  } catch (err) {
    st.className = 'status err'; st.textContent = err.message;
  } finally {
    $('#prepareBtn').disabled = false;
  }
});

function renderMatchResults(data) {
  const { matched, unmatched, unmatched_files, protect_errors, ai_errors } = data;
  const container = $('#matchResults');
  container.textContent = '';

  if (matched.length > 0) {
    container.appendChild(el('div', 'section-label', `Matched (${matched.length}) — PDFs protected and ready`));
    const table = el('table', 'match-table');
    const thead = el('thead');
    const hr = el('tr');
    ['Employee', 'Email', 'File', 'Confidence'].forEach((t) => hr.appendChild(el('th', null, t)));
    thead.appendChild(hr);
    table.appendChild(thead);
    const tbody = el('tbody');
    for (const m of matched) {
      const tr = el('tr');
      tr.appendChild(el('td', null, m.name));
      tr.appendChild(el('td', null, m.email));
      tr.appendChild(el('td', null, m.filename));
      const confCls = m.confidence === 'high' ? 'badge-high' : m.confidence === 'medium' ? 'badge-medium' : 'badge-low';
      tr.appendChild(el('td', confCls, m.confidence));
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    container.appendChild(table);
  }

  if (unmatched.length > 0) {
    const lbl = el('div', 'section-label', `Unmatched recipients (${unmatched.length}) — will be skipped`);
    lbl.style.color = '#b45309';
    container.appendChild(lbl);
    const ul = el('ul', 'warn-list');
    for (const u of unmatched) ul.appendChild(el('li', null, `${u.name} <${u.email}>`));
    container.appendChild(ul);
  }

  if (unmatched_files && unmatched_files.length > 0) {
    const lbl = el('div', 'section-label', `Unmatched files (${unmatched_files.length}) — not sent`);
    lbl.style.color = '#999';
    container.appendChild(lbl);
    const ul = el('ul', 'warn-list');
    ul.style.color = '#999';
    for (const f of unmatched_files) ul.appendChild(el('li', null, f));
    container.appendChild(ul);
  }

  if (protect_errors && protect_errors.length > 0) {
    const lbl = el('div', 'section-label', `Protection errors (${protect_errors.length})`);
    lbl.style.color = '#c00';
    container.appendChild(lbl);
    const ul = el('ul', 'warn-list');
    ul.style.color = '#c00';
    for (const e of protect_errors) ul.appendChild(el('li', null, `${e.email}: ${e.error}`));
    container.appendChild(ul);
  }

  if (ai_errors && ai_errors.length > 0) {
    const lbl = el('div', 'section-label', 'AI matching notes');
    lbl.style.color = '#999';
    container.appendChild(lbl);
    const ul = el('ul', 'warn-list');
    ul.style.color = '#999';
    for (const e of ai_errors) ul.appendChild(el('li', null, e));
    container.appendChild(ul);
  }

  const noMatches = matched.length === 0;
  if (noMatches) {
    container.appendChild(el('p', 'status err', 'No payslips could be matched and protected. Check the files and try again.'));
  }
  $('#sendSetupBtn').disabled = noMatches;
  $('#preflightBtn').disabled = noMatches;
}

// ---- Pre-flight check ----
$('#preflightBtn').addEventListener('click', async () => {
  if (!currentRunId) return;
  const st = $('#preflightStatus');
  const container = $('#preflightResult');
  container.textContent = '';
  st.className = 'status'; st.textContent = 'Asking AI to review matches…';
  $('#preflightBtn').disabled = true;

  try {
    const data = await api('/api/payslips/preflight', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ run_id: currentRunId })
    });
    st.textContent = '';

    if (data.skipped) {
      const box = el('div', 'preflight-box preflight-ok');
      box.appendChild(el('strong', null, 'Pre-flight check skipped'));
      box.appendChild(el('p', null, 'No ANTHROPIC_API_KEY configured — set it in Settings to enable AI review.'));
      container.appendChild(box);
      return;
    }

    if (data.all_clear) {
      const box = el('div', 'preflight-box preflight-ok');
      box.appendChild(el('strong', null, '✓ All clear — AI found no issues'));
      if (data.summary) box.appendChild(el('p', null, data.summary));
      container.appendChild(box);
    } else {
      const box = el('div', 'preflight-box preflight-warn');
      box.appendChild(el('strong', null, `⚠ ${data.issues.length} potential issue${data.issues.length === 1 ? '' : 's'} found — review before sending`));
      if (data.summary) {
        const p = el('p', null, data.summary);
        p.style.margin = '.4rem 0 .75rem';
        box.appendChild(p);
      }
      for (const issue of data.issues) {
        const row = el('div', 'preflight-issue');
        const sevCls = issue.severity === 'high' ? 'sev-high' : 'sev-medium';
        row.appendChild(el('span', sevCls, issue.severity.toUpperCase()));
        const detail = el('span');
        detail.textContent = `${issue.name} (${issue.email}) → ${issue.filename}: ${issue.message}`;
        row.appendChild(detail);
        box.appendChild(row);
      }
      container.appendChild(box);
    }
  } catch (err) {
    st.className = 'status err'; st.textContent = 'Pre-flight failed: ' + err.message;
  } finally {
    $('#preflightBtn').disabled = false;
  }
});

// ---- Step 3: Send ----
$('#sendForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!currentRunId) return;
  const st = $('#sendStatus');
  const btn = $('#sendBtn');
  btn.disabled = true;
  st.className = 'status'; st.textContent = 'Creating campaign…';

  try {
    const data = await api('/api/payslips/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        run_id: currentRunId,
        name: $('#campaignName').value,
        subject: $('#emailSubject').value,
        body: $('#emailBody').value,
        batch_size: $('#batchSize').value,
        batch_interval_seconds: $('#batchInterval').value,
        as_draft: $('#asDraft').checked
      })
    });
    st.className = 'status ok';
    st.textContent = `Campaign created — ${data.accepted} payslip${data.accepted === 1 ? '' : 's'} queued. `;
    const link = document.createElement('a');
    link.href = '/';
    link.textContent = 'View campaigns →';
    st.appendChild(link);
    currentRunId = null;
    loadRuns();
  } catch (err) {
    st.className = 'status err'; st.textContent = err.message;
  } finally {
    btn.disabled = false;
  }
});

// ---- Cleanup / server data ----
async function loadRuns() {
  try {
    const runs = await api('/api/payslips/runs');
    const card = $('#cleanupCard');
    const list = $('#runsList');
    list.textContent = '';

    if (runs.length === 0) {
      card.style.display = 'none';
      return;
    }

    card.style.display = '';
    for (const r of runs) {
      const li = el('li');
      const fmt = r.created ? new Date(r.created).toLocaleString() : 'unknown date';
      const info = el('span', null, `Run ${r.run_id} — ${r.recipient_count} payslip${r.recipient_count === 1 ? '' : 's'} — ${fmt}`);
      const delBtn = el('button', 'btn small danger');
      delBtn.textContent = 'Delete';
      delBtn.addEventListener('click', async () => {
        delBtn.disabled = true;
        try {
          await api(`/api/payslips/runs/${r.run_id}`, { method: 'DELETE' });
          loadRuns();
        } catch (err) {
          alert(err.message);
          delBtn.disabled = false;
        }
      });
      li.appendChild(info);
      li.appendChild(delBtn);
      list.appendChild(li);
    }
  } catch { /* ignore */ }
}

$('#deleteAllBtn').addEventListener('click', async () => {
  if (!confirm('Delete ALL payslip data from the server? This removes all protected PDFs and match results.')) return;
  const st = $('#cleanupStatus');
  st.className = 'status'; st.textContent = 'Deleting…';
  try {
    const r = await api('/api/payslips/runs/all', { method: 'DELETE' });
    st.className = 'status ok'; st.textContent = `Deleted ${r.deleted} run${r.deleted === 1 ? '' : 's'}.`;
    currentRunId = null;
    showStep(1);
    loadRuns();
  } catch (err) {
    st.className = 'status err'; st.textContent = err.message;
  }
});

// ---- Boot ----
async function init() {
  const cfg = await fetch('/api/config').then((r) => r.json()).catch(() => ({ authRequired: false }));
  if (cfg.authRequired && !appPassword) { promptLogin(); return; }
  if (cfg.authRequired) {
    try { await api('/api/settings'); } catch { promptLogin(); return; }
  }
  showStep(1);
  loadRuns();
}

init();
