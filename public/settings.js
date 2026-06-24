'use strict';

const $ = (sel) => document.querySelector(sel);
let appPassword = sessionStorage.getItem('appPassword') || '';

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

async function loadSettings() {
  const s = await api('/api/settings');
  const f = $('#settingsForm');
  f.smtp_host.value = s.smtp_host || '';
  f.smtp_port.value = String(s.smtp_port || 465);
  f.smtp_user.value = s.smtp_user || '';
  f.from_name.value = s.from_name || '';
  f.from_email.value = s.from_email || '';
  f.daily_limit.value = s.daily_limit || '';
  f.smtp_pass.value = '';
  f.anthropic_api_key.value = '';
  $('#passHint').textContent = s.smtp_pass_set ? 'A password is already saved — leave blank to keep it.' : '';
  $('#aiHint').textContent = s.anthropic_api_key_set
    ? 'A key is already saved — leave blank to keep it.'
    : 'Not set — AI matching & pre-flight are disabled.';
  $('#settingsStatus').textContent = '';
}

async function saveSettings() {
  const f = $('#settingsForm');
  return api('/api/settings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      smtp_host: f.smtp_host.value,
      smtp_port: f.smtp_port.value,
      smtp_secure: f.smtp_port.value === '465',
      smtp_user: f.smtp_user.value,
      smtp_pass: f.smtp_pass.value,
      from_name: f.from_name.value,
      from_email: f.from_email.value,
      daily_limit: f.daily_limit.value,
      anthropic_api_key: f.anthropic_api_key.value
    })
  });
}

$('#settingsForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const st = $('#settingsStatus');
  st.className = 'status'; st.textContent = 'Saving…';
  try {
    await saveSettings();
    await loadSettings();
    st.className = 'status ok'; st.textContent = 'Saved ✓';
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
    await saveSettings(); // test uses exactly what's on screen
    await api('/api/settings/test', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ to }) });
    st.className = 'status ok'; st.textContent = `Test sent to ${to} — check the inbox.`;
  } catch (err) {
    st.className = 'status err'; st.textContent = 'Test failed: ' + err.message;
  }
});

async function init() {
  const cfg = await fetch('/api/config').then((r) => r.json()).catch(() => ({ authRequired: false }));
  if (cfg.authRequired && !appPassword) { promptLogin(); return; }
  try { await loadSettings(); } catch { /* login dialog shown on 401 */ }
}

init();
