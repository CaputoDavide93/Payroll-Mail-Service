import db from './db.js';

const getStmt = db.prepare('SELECT * FROM settings WHERE id = 1');

export function getSettings() {
  return getStmt.get();
}

// Returns settings safe to send to the browser (password masked).
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
    configured: !!(s.smtp_host && s.smtp_user && s.smtp_pass && s.from_email)
  };
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
    updated_at = datetime('now')
  WHERE id = 1
`);

export function updateSettings(input) {
  const current = getSettings();
  const merged = {
    smtp_host: input.smtp_host ?? current.smtp_host,
    smtp_port: Number(input.smtp_port ?? current.smtp_port),
    smtp_secure: (input.smtp_secure ?? !!current.smtp_secure) ? 1 : 0,
    smtp_user: input.smtp_user ?? current.smtp_user,
    // Empty password means "keep the existing one" so the operator never has to re-type it.
    smtp_pass: input.smtp_pass ? input.smtp_pass : current.smtp_pass,
    from_email: input.from_email ?? current.from_email,
    from_name: input.from_name ?? current.from_name,
    daily_limit: Number(input.daily_limit ?? current.daily_limit)
  };
  updateStmt.run(merged);
  return getPublicSettings();
}

// On first boot, seed settings from environment variables if provided.
export function seedFromEnv() {
  const s = getSettings();
  if (s.smtp_user || s.smtp_pass) return; // already configured, don't clobber
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
      daily_limit: env.DAILY_LIMIT
    });
  }
}
