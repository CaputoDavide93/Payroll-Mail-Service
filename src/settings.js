import db from './db.js';

const getStmt = db.prepare('SELECT * FROM settings WHERE id = 1');

export function getSettings() {
  return getStmt.get();
}

// Returns settings safe to send to the browser (secrets masked).
export function getPublicSettings() {
  const s = getSettings();
  return {
    smtp_host: s.smtp_host,
    smtp_port: s.smtp_port,
    smtp_secure: !!s.smtp_secure,
    smtp_user: s.smtp_user,
    smtp_pass_set: !!s.smtp_pass,
    from_email: s.from_email,
    from_name: s.from_name,
    daily_limit: s.daily_limit,
    anthropic_api_key_set: !!s.anthropic_api_key,
    configured: !!(s.smtp_host && s.smtp_user && s.smtp_pass && s.from_email)
  };
}

export function getAnthropicApiKey() {
  return getSettings().anthropic_api_key || process.env.ANTHROPIC_API_KEY || '';
}

const updateStmt = db.prepare(`
  UPDATE settings SET
    smtp_host = @smtp_host,
    smtp_port = @smtp_port,
    smtp_secure = @smtp_secure,
    smtp_user = @smtp_user,
    smtp_pass = @smtp_pass,
    from_email = @from_email,
    from_name = @from_name,
    daily_limit = @daily_limit,
    anthropic_api_key = @anthropic_api_key,
    updated_at = datetime('now')
  WHERE id = 1
`);

// Parse an integer, falling back when the value is missing/blank/non-numeric.
// (Number('') is 0, which would silently zero out things like daily_limit.)
function toInt(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function assertEmail(value, label) {
  const v = String(value || '').trim();
  if (v && !EMAIL_RE.test(v)) throw new Error(`${label} doesn't look like a valid email address.`);
}

export function updateSettings(input) {
  const current = getSettings();
  const smtp_port = toInt(input.smtp_port, current.smtp_port);

  // TLS mode: honor an explicit choice; otherwise derive it from the port
  // (465 = implicit TLS, anything else = STARTTLS). This stops an env-seeded
  // config that sets only the port from silently using the wrong mode.
  let smtp_secure;
  if (input.smtp_secure !== undefined && input.smtp_secure !== null && input.smtp_secure !== '') {
    smtp_secure = input.smtp_secure ? 1 : 0;
  } else if (input.smtp_port !== undefined && input.smtp_port !== null && input.smtp_port !== '') {
    smtp_secure = smtp_port === 465 ? 1 : 0;
  } else {
    smtp_secure = current.smtp_secure;
  }

  const smtp_user = input.smtp_user ?? current.smtp_user;
  const from_email = input.from_email ?? current.from_email;
  assertEmail(smtp_user, 'The Gmail/Workspace address');
  assertEmail(from_email, 'The From address');

  const merged = {
    smtp_host: input.smtp_host ?? current.smtp_host,
    smtp_port,
    smtp_secure,
    smtp_user,
    smtp_pass: input.smtp_pass ? input.smtp_pass : current.smtp_pass,
    from_email,
    from_name: input.from_name ?? current.from_name,
    daily_limit: Math.max(1, toInt(input.daily_limit, current.daily_limit)),
    anthropic_api_key: input.anthropic_api_key !== undefined
      ? (input.anthropic_api_key || current.anthropic_api_key)
      : current.anthropic_api_key
  };
  updateStmt.run(merged);
  return getPublicSettings();
}

// On first boot, seed settings from environment variables if provided.
export function seedFromEnv() {
  const s = getSettings();
  if (s.smtp_user && s.smtp_pass) return; // already fully configured, don't clobber
  const env = process.env;
  if (env.SMTP_USER || env.SMTP_PASS || env.FROM_EMAIL) {
    updateSettings({
      smtp_host: env.SMTP_HOST,
      smtp_port: env.SMTP_PORT,
      smtp_secure: env.SMTP_SECURE ? env.SMTP_SECURE !== 'false' : undefined,
      smtp_user: env.SMTP_USER,
      smtp_pass: env.SMTP_PASS,
      from_email: env.FROM_EMAIL || env.SMTP_USER,
      from_name: env.FROM_NAME,
      daily_limit: env.DAILY_LIMIT,
      anthropic_api_key: env.ANTHROPIC_API_KEY
    });
  }
}
