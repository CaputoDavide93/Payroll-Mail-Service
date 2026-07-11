# 🔒 Security Policy

## Reporting a vulnerability

Please report vulnerabilities privately via
[GitHub Security Advisories](https://github.com/CaputoDavide93/Payroll-Mail-Service/security/advisories/new)
rather than opening a public issue. You should get a response within a week.

## Data handling

This service processes payslips — personal data under GDPR. It is designed to
run **self-hosted** (locally or on your own server); no data is sent to third
parties beyond the SMTP provider you configure, and — only if you opt in to AI
matching — recipient names, email addresses and payslip *filenames* sent to
the Anthropic API (never payslip contents or NI numbers).

What the code guarantees (see `src/preparePayslips.js`, `server.js`):

- **NI numbers are never stored, logged, or returned by any API** — they are
  used only at the moment of PDF encryption, and error paths deliberately
  suppress the `qpdf` command line because it contains the password.
- **Raw (unprotected) PDFs are deleted from disk** as soon as 256-bit AES
  protection completes; partial outputs are removed on failure.
- **Attachments are deleted** after a campaign is cleaned up.
- `SMTP_PASS` and the Anthropic key are stored only in the local SQLite
  settings (or read from the environment); the API never echoes them back —
  the UI only ever sees a "key is set" boolean.

## Deployment checklist

- ⚠️ **Always set `APP_PASSWORD` on any internet-facing deployment** — without
  it the UI and API are completely unauthenticated.
- Serve behind HTTPS (reverse proxy) if exposed beyond localhost.
- Treat the `data/` directory (database + uploads) as confidential and back it
  up accordingly — or purge it after each payroll run.

## Supported versions

Only the latest commit on `main` is supported.
