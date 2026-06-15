// Utilities for schedule/time handling

// Convert local datetime (YYYY-MM-DD HH:MM[:SS]) plus optional offset minutes to UTC SQL string.
export function toSqlTime(local, offsetMinutes) {
  if (!local) throw new Error('Missing scheduled start date.');

  const m = String(local).match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) throw new Error(`Invalid scheduled start date: "${local}".`);
  const [_, y, mo, d, h, mi, s] = m.map(Number);

  if (Number.isFinite(offsetMinutes)) {
    // offsetMinutes matches Date.getTimezoneOffset semantics: minutes to add to local to reach UTC
    const utcMs = Date.UTC(y, mo - 1, d, h, mi, s || 0) + offsetMinutes * 60_000;
    const utc = new Date(utcMs);
    return utc.toISOString().replace('T', ' ').slice(0, 19);
  }

  const serverDate = new Date(`${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}T${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}:${String(s || 0).padStart(2, '0')}`);
  if (Number.isNaN(serverDate.getTime())) throw new Error(`Invalid scheduled start date: "${local}".`);
  return serverDate.toISOString().replace('T', ' ').slice(0, 19);
}
