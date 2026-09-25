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

What the code guarantees (see `src/prepare-payslips.js`, `server.js`):

- **NI numbers are never stored, logged, or returned by any API** — they are
  used only at the moment of PDF encryption. They are passed to `qpdf` via a
  private (mode 600) argfile that is deleted straight away, so they never
  appear in process arguments, and `qpdf` errors are not propagated.
- **Raw (unprotected) PDFs are deleted from disk** as soon as 256-bit AES
  protection completes; partial outputs are removed on failure.
- **Protected payslips are deleted once sent** (`PAYSLIP_DELETE_AFTER_SEND`,
  default on), and whole payslip runs are purged after
  `PAYSLIP_RETENTION_DAYS` (default 7) unless recipients are still pending.
- **Attachments are deleted** after a campaign is cleaned up.
- **Recipient email addresses are not written to the send log.**
- **SMTP host allowlist** (`SMTP_HOST_ALLOWLIST`): the UI cannot repoint the
  service at an arbitrary server to capture the stored app password, and
  changing the host requires re-entering the password.
- `SMTP_PASS` and the Anthropic key are stored only in the local SQLite
  settings (or read from the environment); the API never echoes them back —
  the UI only ever sees a "key is set" boolean.

## Deployment checklist

- ⚠️ **Always set `APP_PASSWORD` on any internet-facing deployment** — without
  it the UI and API are completely unauthenticated.
- Serve behind HTTPS (reverse proxy) if exposed beyond localhost, with
  `TRUST_PROXY=1` so the login throttle sees real client IPs.
- Restrict network access to known IPs (the Terraform deploy allows only
  `office_cidrs`).
- Treat the `data/` directory (database + uploads) as confidential and back it
  up accordingly — or purge it after each payroll run.

## Supported versions

Only the latest commit on `main` is supported.
