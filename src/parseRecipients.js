import { parse } from 'csv-parse/sync';

const EMAIL_KEYS = ['email', 'e-mail', 'mail', 'email address', 'emailaddress'];
const NAME_KEYS = ['name', 'first name', 'firstname', 'full name', 'fullname', 'first_name'];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function findKey(headerKeys, candidates) {
  for (const c of candidates) {
    const hit = headerKeys.find((h) => h.toLowerCase().trim() === c);
    if (hit) return hit;
  }
  return null;
}

// Parse a CSV buffer into recipient rows. Returns { recipients, errors, columns }.
// Recognizes an email column and a name column case-insensitively; every other
// column is kept and usable as a {placeholder} in the template.
export function parseRecipients(buffer) {
  let records;
  try {
    records = parse(buffer, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
      bom: true,
      relax_column_count: true
    });
  } catch (err) {
    return { recipients: [], errors: [`Could not read the CSV file: ${err.message}`], columns: [] };
  }

  if (records.length === 0) {
    return { recipients: [], errors: ['The CSV file has no data rows.'], columns: [] };
  }

  const headerKeys = Object.keys(records[0]);
  const emailKey = findKey(headerKeys, EMAIL_KEYS);
  const nameKey = findKey(headerKeys, NAME_KEYS);

  if (!emailKey) {
    return {
      recipients: [],
      errors: [`No email column found. Expected a column named one of: ${EMAIL_KEYS.join(', ')}.`],
      columns: headerKeys
    };
  }

  const recipients = [];
  const errors = [];
  const seen = new Set();

  records.forEach((row, i) => {
    const email = String(row[emailKey] || '').trim().toLowerCase();
    const rowNum = i + 2; // +1 for header, +1 for 1-based
    if (!email) { errors.push(`Row ${rowNum}: missing email — skipped.`); return; }
    if (!EMAIL_RE.test(email)) { errors.push(`Row ${rowNum}: "${email}" is not a valid email — skipped.`); return; }
    if (seen.has(email)) { errors.push(`Row ${rowNum}: duplicate ${email} — skipped.`); return; }
    seen.add(email);

    const fields = {};
    for (const [k, v] of Object.entries(row)) fields[k.toLowerCase().trim()] = v;

    recipients.push({
      email,
      name: nameKey ? String(row[nameKey] || '').trim() : '',
      fields
    });
  });

  return { recipients, errors, columns: headerKeys };
}
