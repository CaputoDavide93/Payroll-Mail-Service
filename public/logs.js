'use strict';

const $ = (sel) => document.querySelector(sel);
let appPassword = sessionStorage.getItem('appPassword') || '';

async function api(path) {
  const headers = {};
  if (appPassword) headers['x-app-password'] = appPassword;
  const res = await fetch(path, { headers });
  let data = null;
  try { data = await res.json(); } catch { /* none */ }
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
    await api('/api/logs?since=999999999'); // cheap auth probe
    $('#loginDialog').close();
    poll(); // kick off immediately
  } catch {
    $('#loginError').textContent = 'Wrong password, try again.';
  }
});

// ---- State ----
let cursor = 0;            // highest seq seen
let paused = false;
let level = 'all';
let total = 0;
const MAX_DOM_ROWS = 2000; // trim old rows to keep the page snappy

const win = $('#logwin');

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function fmtTime(iso) {
  const d = new Date(iso);
  return d.toLocaleTimeString('en-GB', { hour12: false }) + '.' + String(d.getMilliseconds()).padStart(3, '0');
}

function rowMatchesFilter(levelName) {
  return level === 'all' || level === levelName;
}

function addEntry(e) {
  const row = el('div', `logrow lv-${e.level}`);
  row.dataset.level = e.level;
  row.appendChild(el('span', 't', fmtTime(e.ts)));
  row.appendChild(el('span', 'lvl', e.level));
  row.appendChild(el('span', 'cat', e.category));
  row.appendChild(el('span', 'msg', e.message));
  if (!rowMatchesFilter(e.level)) row.style.display = 'none';
  win.appendChild(row);
}

function trimDom() {
  while (win.children.length > MAX_DOM_ROWS) win.removeChild(win.firstChild);
}

function applyFilter() {
  for (const row of win.querySelectorAll('.logrow')) {
    row.style.display = rowMatchesFilter(row.dataset.level) ? '' : 'none';
  }
}

async function poll() {
  if (paused) return;
  try {
    const { entries } = await api(`/api/logs?since=${cursor}`);
    if (entries && entries.length) {
      const emptyMsg = $('#emptyMsg');
      if (emptyMsg) emptyMsg.remove();
      const atBottom = win.scrollHeight - win.scrollTop - win.clientHeight < 60;
      for (const e of entries) {
        addEntry(e);
        cursor = Math.max(cursor, e.seq);
        total++;
      }
      trimDom();
      $('#countPill').textContent = `${total} entr${total === 1 ? 'y' : 'ies'}`;
      if ($('#autoscroll').checked && atBottom) win.scrollTop = win.scrollHeight;
    }
  } catch (err) {
    if (err.message === 'Unauthorized') return; // login dialog already shown
  }
}

// ---- Controls ----
$('#levelSeg').addEventListener('click', (e) => {
  const btn = e.target.closest('button');
  if (!btn) return;
  level = btn.dataset.level;
  for (const b of $('#levelSeg').children) b.classList.toggle('active', b === btn);
  applyFilter();
});

$('#pauseBtn').addEventListener('click', () => {
  paused = !paused;
  $('#pauseBtn').textContent = paused ? '▶ Resume' : '⏸ Pause';
  $('#liveDot').classList.toggle('paused', paused);
  $('#liveText').textContent = paused ? 'Paused' : 'Live';
  if (!paused) poll();
});

$('#clearBtn').addEventListener('click', () => {
  win.querySelectorAll('.logrow').forEach((r) => r.remove());
  // Note: clears the view only; cursor stays so we don't re-fetch old entries.
});

// ---- Boot ----
async function init() {
  const cfg = await fetch('/api/config').then((r) => r.json()).catch(() => ({ authRequired: false }));
  if (cfg.authRequired && !appPassword) { promptLogin(); }
  else {
    try { await api('/api/logs?since=999999999'); } catch { return; } // triggers login on 401
  }
  poll();
  setInterval(poll, 1500);
}

init();
