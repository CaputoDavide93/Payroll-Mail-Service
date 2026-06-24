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
  if (res.status === 401) {
    // Clear the rejected password so auto-refreshing pages stop resending it (a bad
    // password resent every few seconds is what triggers repeated brute-force lockouts).
    appPassword = ''; sessionStorage.removeItem('appPassword');
    promptLogin(); throw new Error('Unauthorized');
  }
  if (!res.ok) throw new Error((data && data.error) || `Request failed (${res.status})`);
  return data;
}

function promptLogin() {
  const dlg = $('#loginDialog');
  if (!dlg.open) dlg.showModal();
}

$('#loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const pw = $('#loginPassword').value;
  const errEl = $('#loginError');
  errEl.className = 'status'; errEl.textContent = 'Checking…';
  try {
    const res = await fetch('/api/settings', { headers: { 'x-app-password': pw } });
    if (res.status === 429) { errEl.className = 'status err'; errEl.textContent = 'Too many attempts — wait about a minute, then enter the password once.'; return; }
    if (res.status === 401) { errEl.className = 'status err'; errEl.textContent = 'Wrong password, try again.'; return; }
    if (!res.ok) { errEl.className = 'status err'; errEl.textContent = 'Login failed (server error ' + res.status + '). Try again shortly.'; return; }
    appPassword = pw;
    sessionStorage.setItem('appPassword', appPassword);
    errEl.textContent = '';
    location.reload();
  } catch {
    errEl.className = 'status err'; errEl.textContent = 'Network error — check your connection and try again.';
  }
});

// (Settings is now its own page: /settings.html)

// ---- Step navigation ----
function showStep(n) {
  // Must use an explicit 'block' (not '') for the active step: the stylesheet has
  // `#step2, #step3 { display: none }`, so clearing the inline style would fall back
  // to that rule and the step would stay hidden.
  $('#step1').style.display = n === 1 ? 'block' : 'none';
  $('#step2').style.display = n === 2 ? 'block' : 'none';
}

$('#backBtn').addEventListener('click', () => {
  currentRunId = null;
  $('#protectedHandoff').style.display = 'none';
  $('#preflightBtn').disabled = true;
  showStep(1);
});

// ---- DOM helpers ----
function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

// ---- Step 1: Prepare ----
let preparing = false;
$('#prepareBtn').addEventListener('click', async () => {
  if (preparing) return;
  preparing = true;
  const excelFile = $('#excelFile').files[0];
  const zipFile = $('#zipFile').files[0];
  const st = $('#prepareStatus');

  if (!excelFile) { st.className = 'status err'; st.textContent = 'Please select the Excel file.'; return; }
  if (!zipFile) { st.className = 'status err'; st.textContent = 'Please select the ZIP file.'; return; }

  st.className = 'status'; st.textContent = '';
  $('#prepareBtn').disabled = true;
  startPrepareProgress();

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
    // Reset state for new prepare
    $('#preflightResult').textContent = '';
    $('#preflightStatus').textContent = '';
    $('#approveStatus').textContent = '';
    $('#preflightBtn').disabled = true;
    $('#protectedHandoff').style.display = 'none';
    stopPrepareProgress(true);
    renderReviewTable(data);
    st.textContent = '';
    showStep(2);
    loadRuns();
  } catch (err) {
    stopPrepareProgress(false);
    st.className = 'status err'; st.textContent = err.message;
  } finally {
    preparing = false;
    $('#prepareBtn').disabled = false;
  }
});

// --- Prepare progress bar ---------------------------------------------------
// The /prepare POST blocks until the worker finishes (extract + AI matching),
// so we show a smooth time-based crawl with stage labels rather than a fake
// precise percentage. It eases toward 90% and snaps to 100% on completion.
let progTimer = null;
function startPrepareProgress() {
  const box = $('#prepareProgress'), bar = $('#progBar'), stage = $('#progStage'), time = $('#progTime');
  box.hidden = false;
  const started = Date.now();
  let pct = 0;
  bar.style.width = '0%';
  const stages = [
    [0, 'Uploading files…'],
    [3, 'Extracting PDFs from ZIP…'],
    [7, 'Matching payslips with AI…'],
    [45, 'Still matching — large batches take longer…'],
  ];
  if (progTimer) clearInterval(progTimer);
  progTimer = setInterval(() => {
    const el = (Date.now() - started) / 1000;
    time.textContent = Math.floor(el) + 's';
    pct = Math.min(90, pct + (90 - pct) * 0.05);
    bar.style.width = pct.toFixed(1) + '%';
    let lbl = stages[0][1];
    for (const [t, l] of stages) if (el >= t) lbl = l;
    stage.textContent = lbl;
  }, 400);
}
function stopPrepareProgress(ok) {
  if (progTimer) { clearInterval(progTimer); progTimer = null; }
  const box = $('#prepareProgress'), bar = $('#progBar'), stage = $('#progStage');
  if (ok) {
    bar.style.width = '100%';
    stage.textContent = 'Done';
    setTimeout(() => { box.hidden = true; bar.style.width = '0%'; }, 700);
  } else {
    box.hidden = true;
    bar.style.width = '0%';
  }
}

// Tracks which employee emails are still approved (deleted rows remove from this set)
let approvedEmails = new Set();

function updateApproveBtn() {
  const n = approvedEmails.size;
  const btn = $('#approveBtn');
  btn.disabled = n === 0;
  btn.textContent = `Approve & Protect ${n} payslip${n === 1 ? '' : 's'} →`;
}

// All filenames available in this run (matched + leftover) — used to populate the
// per-row correction dropdowns so a wrong/blank match can be fixed before protecting.
let allFiles = [];
// email -> chosen filename for the final protect step (seeded from auto-matches).
let assignments = new Map();

function buildFileSelect(email, current) {
  const sel = el('select', 'file-select');
  const none = el('option', null, '— choose file —');
  none.value = '';
  sel.appendChild(none);
  for (const f of allFiles) {
    const o = el('option', null, f);
    o.value = f;
    sel.appendChild(o);
  }
  sel.value = current || '';
  sel.addEventListener('change', () => {
    const row = sel.closest('tr');
    if (sel.value) {
      assignments.set(email, sel.value);
      approvedEmails.add(email);
      if (row) row.classList.remove('row-bad');
    } else {
      assignments.delete(email);
      approvedEmails.delete(email);
      if (row) row.classList.add('row-bad');
    }
    updateApproveBtn();
  });
  return sel;
}

function reviewRow({ name, email, ni_no, filename, confidence }, { rowClass }) {
  const tr = el('tr', rowClass || null);
  tr.dataset.email = email;
  tr.appendChild(el('td', null, name));
  const niTd = el('td');
  niTd.style.cssText = 'font-family:monospace;font-size:.85rem;letter-spacing:.04em';
  niTd.textContent = ni_no || '— missing —';
  if (!ni_no) niTd.style.color = '#b91c1c';
  tr.appendChild(niTd);
  tr.appendChild(el('td', null, email));
  const fileTd = el('td');
  fileTd.appendChild(buildFileSelect(email, filename));
  tr.appendChild(fileTd);
  const confCls = confidence === 'high' ? 'badge-high' : confidence === 'medium' ? 'badge-medium' : 'badge-low';
  tr.appendChild(el('td', confCls, confidence || 'unmatched'));
  const tdAct = el('td');
  const delBtn = el('button', 'btn small danger');
  delBtn.textContent = 'Remove';
  delBtn.addEventListener('click', () => {
    tr.style.opacity = '0.35';
    tr.style.textDecoration = 'line-through';
    delBtn.disabled = true;
    approvedEmails.delete(email);
    assignments.delete(email);
    updateApproveBtn();
  });
  tdAct.appendChild(delBtn);
  tr.appendChild(tdAct);
  return tr;
}

function renderReviewTable(data) {
  const { pending = [], unmatched = [], unmatched_files = [], no_ni = [], ai_errors = [] } = data;
  const container = $('#matchResults');
  container.textContent = '';

  // Build the full file list + seed approvals/assignments from the auto-matches.
  allFiles = Array.from(new Set([...pending.map((p) => p.filename), ...unmatched_files])).sort();
  approvedEmails = new Set(pending.map((p) => p.email));
  assignments = new Map(pending.map((p) => [p.email, p.filename]));

  // Recipients that still need a file (no auto-match) but have an NI — fixable here.
  const assignable = unmatched.filter((u) => u.ni_no);

  const intro = el('p', 'muted', 'Check each match. Amber = low-confidence, red = needs a file. Use the dropdown to correct any wrong or missing file before approving.');
  intro.style.cssText = 'font-size:.85rem;margin:.25rem 0 .75rem';
  container.appendChild(intro);

  if (pending.length || assignable.length) {
    const table = el('table', 'match-table');
    const thead = el('thead');
    const hr = el('tr');
    ['Full Name', 'NI No', 'Email', 'PDF File', 'Match', ''].forEach((t) => hr.appendChild(el('th', null, t)));
    thead.appendChild(hr);
    table.appendChild(thead);
    const tbody = el('tbody');

    for (const m of pending) {
      const rowClass = m.confidence === 'low' ? 'row-bad' : m.confidence === 'medium' ? 'row-warn' : null;
      tbody.appendChild(reviewRow(m, { rowClass }));
    }
    // Unmatched-but-assignable recipients: red until a file is chosen.
    for (const u of assignable) {
      tbody.appendChild(reviewRow({ name: u.name, email: u.email, ni_no: u.ni_no, filename: '', confidence: 'low' }, { rowClass: 'row-bad' }));
    }
    table.appendChild(tbody);
    container.appendChild(table);
  }

  if (no_ni.length) {
    const lbl = el('div', 'section-label', `Missing NI No (${no_ni.length}) — cannot protect, will be skipped`);
    lbl.style.color = '#b91c1c';
    container.appendChild(lbl);
    const ul = el('ul', 'warn-list');
    for (const u of no_ni) ul.appendChild(el('li', null, `${u.name} <${u.email}>`));
    container.appendChild(ul);
  }

  if (unmatched_files.length) {
    const det = el('details');
    det.style.cssText = 'margin-top:1rem';
    const sum = el('summary', null, `Unassigned files (${unmatched_files.length}) — available in the dropdowns above`);
    sum.style.cssText = 'cursor:pointer;color:#666;font-size:.85rem';
    det.appendChild(sum);
    const ul = el('ul', 'warn-list');
    ul.style.cssText = 'color:#999;max-height:220px;overflow:auto';
    for (const f of unmatched_files) ul.appendChild(el('li', null, f));
    det.appendChild(ul);
    container.appendChild(det);
  }

  if (ai_errors.length) {
    const det = el('details');
    det.style.cssText = 'margin-top:.75rem';
    det.appendChild(el('summary', null, 'AI matching notes'));
    const ul = el('ul', 'warn-list');
    ul.style.color = '#999';
    for (const e of ai_errors) ul.appendChild(el('li', null, e));
    det.appendChild(ul);
    container.appendChild(det);
  }

  if (!pending.length && !assignable.length) {
    container.appendChild(el('p', 'status err', 'No payslips could be matched. Use the dropdowns to assign files manually, or check filenames against employee names.'));
  }

  updateApproveBtn();
}

// ---- Approve & Protect ----
$('#approveBtn').addEventListener('click', async () => {
  if (!currentRunId || !approvedEmails.size) return;
  const st = $('#approveStatus');
  const btn = $('#approveBtn');
  btn.disabled = true;
  st.className = 'status'; st.textContent = `Protecting ${approvedEmails.size} PDF${approvedEmails.size === 1 ? '' : 's'}…`;

  try {
    const data = await api(`/api/payslips/${currentRunId}/confirm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ selections: [...approvedEmails].map((email) => ({ email, filename: assignments.get(email) })).filter((x) => x.filename) })
    });

    let msg = `✓ ${data.protected_count} PDF${data.protected_count === 1 ? '' : 's'} protected.`;
    if (data.protect_errors?.length) msg += ` ${data.protect_errors.length} failed — see below.`;
    st.className = 'status ok'; st.textContent = msg;

    // Surface per-recipient protection failures (missing NI, duplicate/missing file, qpdf error).
    const errBox = $('#approveErrors');
    if (errBox) {
      errBox.textContent = '';
      if (data.protect_errors?.length) {
        const lbl = el('div', 'section-label', `Failed to protect (${data.protect_errors.length})`);
        lbl.style.color = '#b91c1c';
        errBox.appendChild(lbl);
        const ul = el('ul', 'warn-list');
        for (const e of data.protect_errors) ul.appendChild(el('li', null, `${e.email}: ${e.error}`));
        errBox.appendChild(ul);
      }
    }

    btn.textContent = 'Protected ✓';
    $('#preflightBtn').disabled = false;
    $('#protectedHandoff').style.display = 'block';
    loadRuns();
  } catch (err) {
    st.className = 'status err'; st.textContent = 'Protection failed: ' + err.message;
    btn.disabled = false;
  }
});

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
      const n = r.recipient_count;
      const detail = r.status === 'protected'
        ? `${n} protected payslip${n === 1 ? '' : 's'}`
        : `${n} matched — awaiting approval (not yet protected)`;
      const info = el('span', null, `${r.name || r.run_id} — ${detail}`);
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
  } catch (err) {
    if (err.message === 'Unauthorized') throw err; // let auth errors propagate
  }
}

$('#deleteAllBtn').addEventListener('click', async () => {
  if (!confirm('Delete ALL payslip data from the server?\n\nWARNING: If you have already created a campaign from these payslips and it is still sending, those emails will fail because the attached PDFs will be deleted.\n\nThis cannot be undone.')) return;
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
